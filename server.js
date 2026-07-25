const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let waitingPlayers = [];

const K_list = ["Trật tự", "Quyền lực", "Ngoại giao", "Cô độc", "Phòng thủ", "Phụ thuộc", "Nhạy cảm", "Trí tuệ", "Hành động", "Thích nghi"];
const X_list = ["Khắc kỷ", "Cuồng nhiệt", "Trì hoãn", "Cầu toàn", "Nổi loạn", "Cơ hội", "Đạo đức giả", "Tùy hứng", "Cam chịu", "Sách vở"];
const M_list = ["Ái kỷ", "Hoang tưởng", "Cuồng sát", "Tự ngược", "Thao túng", "Cuồng tín", "Vô cảm", "Hư vô", "Ký sinh", "Yandere"];

function getRandomPersonality() {
    let k = K_list[Math.floor(Math.random() * K_list.length)];
    let x = X_list[Math.floor(Math.random() * X_list.length)];
    let m = M_list[Math.floor(Math.random() * M_list.length)];
    return `Kẻ ${k} ${x} ${m}`;
}

io.on('connection', (socket) => {
    socket.on('find_match', (userData) => {
        if (!waitingPlayers.some(p => p.socket.id === socket.id)) {
            waitingPlayers.push({ socket, data: userData });
        }
        if (waitingPlayers.length >= 12) {
            let matchGroup = waitingPlayers.splice(0, 12);
            let roomID = 'room_' + Date.now();
            let roomPlayers = matchGroup.map((p, index) => {
                let gender = Math.random() < 0.5 ? 'Nam' : 'Nữ';
                return {
                    id: `[${(index + 1).toString().padStart(2, '0')}]`,
                    name: p.data.name || `Bot_${index}`,
                    gender: gender,
                    personality: getRandomPersonality(),
                    rank: p.data.rank || 'Kim Cương'
                };
            });
            matchGroup.forEach(p => p.socket.join(roomID));
            io.to(roomID).emit('match_started', { roomID, players: roomPlayers });
        }
    });

    socket.on('disconnect', () => {
        waitingPlayers = waitingPlayers.filter(p => p.socket.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server chạy tại cổng ${PORT}`);
});
