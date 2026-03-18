const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const BiliClient = require("./src/danmaku");
const { ROOMID, COOKIE } = require("./config.js");

const app = express();
const server = http.createServer(app);
const port = 3000;

app.use(express.static('overlay'));
let clients = [];

async function main() {
    const bili = new BiliClient(ROOMID, COOKIE);
    await bili.connect();

    //Host ActivityTigger page locally
    app.get("/ActivityTriggers", (req, res) => {
        res.sendFile(__dirname + "/overlay/ActivityTracker.html");
    });
    app.use(express.static('overlay')); 

    //Broadcasts messages through this
    app.get("/stream", (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        clients.push(res);

        req.on("close", () => {
            clients = clients.filter(c => c !== res);
        });
    });

    app.get("/config.js", (req, res) => {
        res.sendFile(path.join(__dirname, "config.js"));
    });

    //Reacts to events from biliclient.
    bili.on("message", ({ username, text }) => {
        clients.forEach(client => {
            client.write(`data: ${JSON.stringify({ username, text })}\n\n`);
        });
    });

    //Open server (locally)
    server.listen(port, () => {
        console.log(`Overlay running at http://localhost:${port}`);
    });
}

main();