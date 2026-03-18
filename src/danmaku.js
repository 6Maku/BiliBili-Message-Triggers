const WebSocket = require("ws");
const axios = require("axios");
const zlib = require("zlib");
const EventEmitter = require("events");
const { Console } = require("console");


/*
Op codes:
0: Handshake
1: Handshake reply
2: Heartbeat
3: Heartbeat reply
4: Normal message
5: Compressed message (zlib)
7: Authentication
8: Authentication reply
*/



class BiliClient extends EventEmitter {
    constructor(roomId, cookies = "") {
        super();
        this.roomId = roomId;
        this.cookies = cookies;
        this.ws = null;
        this.heartbeatInterval = null;
    }

    /*getCookieValue(name) {
        if (!this.cookies) return "";
        const match = this.cookies.match(new RegExp(`${name}=([^;]+)`));
        return match ? match[1] : "";
    }*/

    async getNavInfo() {
        // Check if cookies are valid and get UID
        if (!this.cookies) return 0;
        
        try {
            const res = await axios.get("https://api.bilibili.com/x/web-interface/nav", {
                headers: {
                    "Cookie": this.cookies,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0",
                    "Referer": "https://live.bilibili.com/"
                }
            });
            
            if (res.data?.data?.isLogin) {
                console.log("[DEBUG] Logged in as:", res.data.data.uname, "UID:", res.data.data.mid);
                // res.data.data.face  this is your profile picture
                return res.data.data.mid;
            } else throw new Error("Could not login")
        } catch (e) {
            console.log("[DEBUG] Login failed:", e.message);
        }
        return 0;
    }

    async getDanmuInfo(roomId) {
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0",
            "Referer": `https://live.bilibili.com/${roomId}`,
            "Origin": "https://live.bilibili.com",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
        };

        if (this.cookies && this.cookies.includes("buvid3")) {
            headers["Cookie"] = this.cookies;
        }

        const url = `https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${roomId}&platform=pc&player=web`;
        const res = await axios.get(url, { headers, timeout: 10000, maxRedirects: 0});
        
        if (res.data?.code === 0 && res.data?.data) {
            return res.data.data;
        }

        console.error("Failed to get Danmu info: " + (res.data?.message || "Unknown error"));
        return this.getFallbackConfig(roomId);
    }

    /*getFallbackConfig(roomId) {
        console.log("[DEBUG] Using fallback config for room:", roomId);
        return {
            room_id: roomId,
            token: "",  // Empty token often works for basic connections
            host_server_list: [
                { host: "broadcastlv.chat.bilibili.com", wss_port: 443, ws_port: 2243 }
            ]
        };
    }*/

    encode(data, op) {
        const json = Buffer.from(JSON.stringify(data), "utf8");
        const packetLen = 16 + json.length;
        const header = Buffer.alloc(16);

        header.writeUInt32BE(packetLen, 0);
        header.writeUInt16BE(16, 4);
        header.writeUInt16BE(1, 6);
        header.writeUInt32BE(op, 8);
        header.writeUInt32BE(1, 12);

        return Buffer.concat([header, json]);
    }

    startHeartbeat(ws) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            //console.log("[DEBUG] Sending heartbeat...");
            ws.send(this.encode({}, 2));
        }, 30000);
    }


    unpackPayload(buffer) {
        let results = [];
        let offset = 0;

        while (offset + 16 <= buffer.length) {
            const packetLen = buffer.readUInt32BE(offset);
            const headerLen = buffer.readUInt16BE(offset + 4);
            const protover = buffer.readUInt16BE(offset + 6);
            const op = buffer.readUInt32BE(offset + 8);
            
            if (packetLen < 16 || offset + packetLen > buffer.length) {
                console.error(`[DEBUG] Illegal packet length: ${packetLen} at offset ${offset}`);
                break; 
            }

            const body = buffer.slice(offset + headerLen, offset + packetLen);
            
            if (op === 5) { 
                try {
                    let decompressed;
                    if (protover === 2) {
                        decompressed = zlib.inflateSync(body);
                    } else if (protover === 3) {
                        decompressed = zlib.brotliDecompressSync(body);
                    }

                    if (decompressed) {
                        results.push(...this.unpackPayload(decompressed));
                    } else {
                        results.push({ op, protover, body });
                    }
                } catch (e) {
                    console.error("[ERROR] Decompression failed:", e.message);
                }
            } else {
                results.push({ op, protover, body });
            }

            offset += packetLen;
        }
        return results;
    }


    handleCommand(json) {
        //console.log("[DEBUG] Received command:", json.cmd);

        /* Extra commands that are currently not handled:
        INTERACT_WORD_V2
        LIKE_INFO_V3
        WATCHED_CHANGE
        ONLINE_RANK_COUNT
        ENTRY_EFFECT
        RANK_REM
        POPULAR_RANK_CHANGED
        RANK_CHANGED_V2
        STOP_LIVE_ROOM_LIST
        NOTICE_MSG
        ROOM_REAL_TIME_MESSAGE_UPDATE
        */

        switch (json.cmd) {
            case "DANMU_MSG":
                const guardLevel = json.info[7];
                let prefix = "";
                if (guardLevel === 3) prefix = "🚢 [Captain] ";
                if (guardLevel === 2) prefix = "🚩 [Admiral] ";
                if (guardLevel === 1) prefix = "👑 [Governor] ";

                const hasMedal = json.info[3].length > 0;
                const medalName = hasMedal ? json.info[3][1] : "";
                const username = json.info[2][1];
                const text = json.info[1];

                console.log(`[DANMU] ${prefix}[${medalName}] ${username}: ${text}`);
                this.emit("message", { username, text, prefix, medalName });
                break;

            case "SEND_GIFT":
                const giftUser = json.data.uname;
                const giftName = json.data.giftName;
                const giftNum = json.data.num;
                console.log(`[GIFT] ${giftUser} sent ${giftNum} x ${giftName}`);
                this.emit("gift", { username: giftUser, gift: giftName, num: giftNum });
                break;

            case "GUARD_BUY":
                const guardUser = json.data.uname;
                const guardType = json.data.gift_name;
                console.log(`[GUARD] ${guardUser} bought ${guardType}`);
                this.emit("guard", { username: guardUser, type: guardType });
                break;

            case "SUPER_CHAT_MESSAGE":
                const scUser = json.data.user_info.uname;
                const scPrice = json.data.price;
                const scMessage = json.data.message;
                console.log(`[SUPERCHAT] ${scUser} paid ${scPrice}: ${scMessage}`);
                this.emit("superchat", { username: scUser, price: scPrice, message: scMessage });
                break;

            case "ONLINE_RANK_COUNT":
                console.log(`[ONLINE_RANK] Amount people in chat: ${json.data.count}`);
                break;
        }
    }


    async connect() {
        try {
            this.uid = await this.getNavInfo();
            const danmuInfo = await this.getDanmuInfo(this.roomId);
            this.roomId = danmuInfo.room_id || this.roomId;
            console.log("[DEBUG] Token received:", danmuInfo.token ? "Yes" : "No");

            for (let i = 0; i < danmuInfo.host_server_list.length; i++) {
                const hostInfo = danmuInfo.host_server_list[i];
                const host = hostInfo.host;
                const port = hostInfo.wss_port || 443;
                const wsUrl = `wss://${host}:${port}/sub`;
                                
                try {
                    await this.tryConnect(wsUrl, danmuInfo.token);
                    console.log("[DEBUG] Successfully connected and authenticated!");
                    return; // Success, exit the loop
                } catch (err) {
                    //console.error(`[ERROR] Host ${host} failed:`, err.message);
                    // Continue to next host
                }
            }
            
            throw new Error("All hosts failed to connect");
            
        } catch (err) {
            console.error("[ERROR] Connect failed:", err.message);
            throw err;
        }
    }

    tryConnect(wsUrl, token) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0",
                    "Origin": "https://live.bilibili.com",
                    "Cookie": this.cookies || ""
                }
            });
            
            let heartbeatTimeout = null;
            let isAuthenticated = false;
            
            // Connection timeout - if no auth reply in 10 seconds
            const connectionTimeout = setTimeout(() => {
                if (!isAuthenticated) {
                    ws.terminate();
                    reject(new Error("Connection timeout - no auth reply"));
                }
            }, 10000);
            
            ws.on("open", () => {
                console.log("[DEBUG] WebSocket opened! Sending auth packet...");
                
                const authPayload = {
                    uid: this.uid,
                    roomid: parseInt(this.roomId),
                    protover: 3,
                    platform: "web",
                    clientver: "1.14.3",
                    type: 2,
                    key: token,
                    buvid: this.buvid
                };
                
                ws.send(this.encode(authPayload, 7)); // op 7 = auth
                this.startHeartbeat(ws);
            });
            
            ws.on("message", (msg) => {
                const packets = this.unpackPayload(msg);
                
                for (const packet of packets) {
                    const raw = packet.body.toString("utf8");
                                        
                    switch (packet.op) {
                        case 8: // Auth reply - connection successful!
                            if (!isAuthenticated) {
                                isAuthenticated = true;
                                clearTimeout(connectionTimeout);
                                
                                try {
                                    const authRes = JSON.parse(raw);
                                    console.log("[DEBUG] Auth response:", authRes);
                                    
                                    if (authRes.code === 0) {
                                        console.log("[DEBUG] Authentication successful!");
                                        this.ws = ws; // Store successful connection
                                        resolve();
                                    } else {
                                        reject(new Error(`Auth failed: ${authRes.message || "Unknown error"}`));
                                    }
                                } catch (e) {
                                    console.log("[DEBUG] Auth success (non-JSON response)");
                                    this.ws = ws;
                                    resolve();
                                }
                            }
                            break;
                            
                        case 3: // Heartbeat reply
                            if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
                            // Set new heartbeat timeout - if no reply in 60s, reconnect
                            heartbeatTimeout = setTimeout(() => {
                                console.error("[ERROR] Heartbeat timeout - connection lost");
                                this.reconnect();
                            }, 60000);
                            break;
                            
                        case 5: // Danmu/message
                        case 4: // Normal message
                            try {
                                const json = JSON.parse(raw);
                                this.handleCommand(json);
                            } catch (e) {
                                console.error("[ERROR] JSON parse failed:", e.message, "Raw:", raw.slice(0, 100));
                            }
                            break;
                            
                        default:
                            console.log(`[DEBUG] Unhandled packet op: ${packet.op}`);
                    }
                }
            });
            
            ws.on("error", (err) => {
                console.error("[ERROR] WebSocket error:", err.message);
                clearTimeout(connectionTimeout);
                reject(err);
            });
            
            ws.on("close", (code, reason) => {
                console.log(`[DEBUG] WebSocket closed: ${code}, ${reason}`);
                clearTimeout(connectionTimeout);
                if (!isAuthenticated) {
                    reject(new Error(`Connection closed before auth: ${code}`));
                } else {
                    this.emit("disconnect", { code, reason });
                    this.reconnect();
                }
            });
        });
    }

    reconnect() {
        console.log("[DEBUG] Reconnecting in 3 seconds...");
        if (this.ws) {
            try {
                this.ws.terminate();
            } catch (e) {}
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        setTimeout(() => {
            this.connect().catch(err => {
                console.error("[ERROR] Reconnect failed:", err.message);
            });
        }, 3000);
    }
}

module.exports = BiliClient;
