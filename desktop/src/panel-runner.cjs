const Module = require("node:module")
const path = require("node:path")

const dependenciesDir = path.resolve(__dirname, "..", "panel-deps")
process.env.NODE_PATH = [dependenciesDir, process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
Module._initPaths()

require(path.join(__dirname, "server.js"))
