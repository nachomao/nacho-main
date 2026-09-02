import assert from "node:assert/strict"
import dotenv from "/opt/control-server/node_modules/dotenv/lib/main.js"

dotenv.config({ path: "/opt/control-server/.env" })
const base = "http://127.0.0.1:8443"
const fixtureName = `purge-zero-residue-${Date.now()}`

const enrolled = await fetch(`${base}/agent/enroll`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ enrollmentKey: process.env.ENROLLMENT_KEY, name: fixtureName, os: "Windows" }),
})
assert.equal(enrolled.status, 201)
const enrollment = await enrolled.json()
const clientId = enrollment.data.client.id
const token = enrollment.data.token

const purged = await fetch(`${base}/agent/client`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${token}` },
})
assert.equal(purged.status, 200)

const listed = await fetch(`${base}/api/panel/clients`, {
  headers: { authorization: `Bearer ${process.env.PANEL_API_KEY}` },
})
assert.equal(listed.status, 200)
const clients = await listed.json()
assert.equal(clients.data.some((client) => client.id === clientId), false)

console.log("live fixture output: enroll=201; purge=200; panelRecord=absent")
console.log("live fixture exit: 0")
