require('dotenv').config()
const app = require('express')()
const server = require('http').Server(app)
const cors = require('cors')
const axios = require('axios')
const io = require('socket.io')(server, {
  cors: {
    origin: ['http://localhost:3001', 'https://socket-learn.vercel.app'],
    methods: ["GET", "POST"]
  }
})

const expressCorsOptions = {
  origin: [
    'http://localhost:3001', 
    'http://localhost:8000',
    'http://192.168.0.3:*', 
    'https://socket-learn.vercel.app'
  ]

}

const bp = require('body-parser')
const port = process.env.PORT || 8003
const questionsEndpoint = process.env.QUESTION_API_URI

app.use(cors(expressCorsOptions))
app.use(bp.json())
app.use(bp.urlencoded({ extended: false }))

// Game variables
let rooms = {}
let socketsIds = {}
let rounds = {}

// SOCKETS
io.on('connection', (socket) => {
  console.log("New user connected")

  socket.on('check-in', (userId) => {
    socketsIds[userId] = socket.id
    socket.username = userId
  })

  socket.on('player-ready', async (userId) => {
    const roomId = findRoomId(userId)

    if (!roomId) {
      socket.emit('previous-afk')
      return
    }

    const userIndex = findUserIndexInRoom(userId, roomId)
    const currentRoom = rooms[roomId]
    socket.join(roomId)
    socket.emit('waiting-for-players-to-be-ready', (roomId))

    currentRoom[userIndex].isReady = true
    
    if (!currentRoom.map(userInRoom => userInRoom.isReady).includes(false)) {
      rounds[roomId] = 0
      io.in(roomId).emit('initialize-game')
      
      getNewQuestion().then(res => {
        ++ rounds[roomId]
        const newRound = {
          roundCounter: rounds[roomId],
          question: res.data.results[0]
        }
        io.in(roomId).emit('new-round', newRound)
      })
      .catch(err => {
        console.log("error bringing the question: ", err)
      })
    }
  })

  socket.on('correct-attempt', (userId) => {
    const roomId = findRoomId(userId)
    const userIndex = findUserIndexInRoom(userId, roomId)
    const currentRoom = rooms[roomId]
    currentRoom[userIndex].points ++

    const roundWinner = currentRoom[userIndex].nickname
    io.in(roomId).emit('round-winner', roundWinner)
    resetBlocks(roomId)
    
    // If there is a winner
    if (rounds[roomId] === 3) {
      const winner = currentRoom[ currentRoom[0].points > currentRoom[1].points ? 0 : 1 ]
      io.in(roomId).emit('game-finished', winner)

      delete rooms[roomId]
      io.socketsLeave(roomId);
      return
    } 

    ++ rounds[roomId]
    
    getNewQuestion().then(res => {
      setTimeout(() => {
        const newRound = {
          roundCounter: rounds[roomId],
          question: res.data.results[0]
        }
        io.in(roomId).emit('new-round', newRound)
      }, 2000)
    })
  })

  socket.on('wrong-attempt', (userId) => {
    const roomId = findRoomId(userId)
    const userIndex = findUserIndexInRoom(userId, roomId)
    const currentRoom = rooms[roomId]
    io.in(roomId).emit('block-turn', userId)

    currentRoom[userIndex].blocked = true
    console.log("current blocked state: ", currentRoom.map(singleUser => singleUser.blocked))
    if (!currentRoom.map(singleUser => singleUser.blocked).includes(false)) {
      io.in(roomId).emit('skip-round')

      resetBlocks(roomId)
      
      getNewQuestion().then(res => {
        setTimeout(() => {
          const newRound = {
            roundCounter: rounds[roomId],
            question: res.data.results[0]
          }
          io.in(roomId).emit('new-round', newRound)
        }, 2000)
      })

    }
  })

  socket.on('disconnect', () => {
    const roomId = findRoomId(socket.username)

    if (roomId) {
      const user = rooms[roomId].filter(singleUser => singleUser.id === socket.username)[0]
      const theOtherGuy = rooms[roomId].filter(singleUser => singleUser.id !== socket.username)[0]
      
      if (!user.isReady) {
        io.sockets.to(socketsIds[theOtherGuy.id]).emit('previous-afk')
        return
      }
  
      io.in(roomId).emit('user-disconnected', socket.username)
      io.socketsLeave(roomId);
      delete rooms[roomId]
    }
  })
})


app.post('/start-new-game', (req, res) => {
  const users = req.body.users
  console.log("New Game With Users: ", req.body)
  const newRoomId = Math.random().toString(16).substr(2, 15)
  rooms[newRoomId] = users.map(singleUser => ({ ...singleUser, isReady: false, points: 0, blocked: false }))
  res.send('Game started')
})

app.get('/check', (_, res) => {
  res.send(rooms)
})

server.listen(port, () => {
  console.log("Listening at *:", port)
})

const findRoomId = (userId) => {
  const roomsValues = Object.values(rooms)
  const singleLevelValues = roomsValues.map(singleRoomValue => (
    singleRoomValue.map(singleObjectInsideRoom => singleObjectInsideRoom.id)
  ))
  const roomIndex = singleLevelValues.findIndex(roomMembers => roomMembers.includes(userId))
  const roomId = Object.keys(rooms)[roomIndex]
  return roomId
}

const findUserIndexInRoom = (userId, roomId) => {
  const userIndex = rooms[roomId].findIndex(userInRoom => (
    userInRoom.id === userId
  ))

  return userIndex
}

const getNewQuestion = async () => {
  console.log("endpoint: ",questionsEndpoint)
  return await axios.get(questionsEndpoint)
}

const resetBlocks = (roomId) => {
  rooms[roomId] = rooms[roomId].map(singleUser => ({ ...singleUser, blocked: false }))
}
