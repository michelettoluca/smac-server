import express from "express"
import dotenv from "dotenv"
import cron from "node-cron"
import ws from "ws"
import { PrismaClient, Reservation, ReservationStatus } from "@prisma/client"
import bodyParser from "body-parser"
import serverless from "serverless-http"

dotenv.config()

const PORT = process.env.PORT

const prisma = new PrismaClient()
const app = express()
const router = express.Router()
const jsonParser = bodyParser.json()

const webSocketServer = new ws.Server({ noServer: true })

webSocketServer.on("connection", async (socket) => {
	const reservation = await getLatestReservation()

	socket.send(JSON.stringify(reservation))
})

cron.schedule("0 0 * * *", async () => {
	const reservation = await prisma.reservation.create({ data: {} })

	await notifySubscribers(reservation)
})

async function notifySubscribers(reservation: Reservation) {
	webSocketServer.clients.forEach((client) =>
		client.send(JSON.stringify(reservation))
	)
}

async function getLatestReservation() {
	return prisma.reservation.findFirst({
		orderBy: {
			createdAt: "desc",
		},
	})
}

async function updateLatestReservationStatus(status: ReservationStatus) {
	const latestReservation = await getLatestReservation()

	if (latestReservation == null) {
		return
	}

	return prisma.reservation.update({
		where: {
			id: latestReservation?.id,
		},
		data: {
			status,
		},
	})
}

router.put("/latest-reservation", jsonParser, async (req, res) => {
	const { status } = req.body

	const reservation = await updateLatestReservationStatus(status)

	if (!reservation) {
		return null
	}

	notifySubscribers(reservation)

	return res.json(reservation)
})

const server = app.listen(PORT, async () => {
	console.log(`[server]: Server is running at http://localhost:${PORT}`)

	const reservation = await getLatestReservation()

	if (!reservation) {
		await prisma.reservation.create({ data: {} })
	}
})

server.on("upgrade", (request, socket, head) => {
	webSocketServer.handleUpgrade(request, socket, head, (socket) => {
		webSocketServer.emit("connection", socket, request)
	})
})

app.use("/.netlify/functions/api", router)

module.exports.handler = serverless(app)
