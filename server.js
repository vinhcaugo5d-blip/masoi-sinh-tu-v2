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

        // Tự động gom đủ hoặc tạo phòng ghép nhanh
        if (waitingPlayers.length >= 1) {
            let matchGroup = waitingPlayers.splice(0, 1);
            let randomRoomID = 'MS' + Math.floor(1000 + Math.random() * 9000);
            
            let roomPlayers = [];
            for (let i = 0; i < 12; i++) {
                let gender = Math.random() < 0.5 ? 'Nam' : 'Nữ';
                let idName = `[${(i + 1).toString().padStart(2, '0')}]`;
                if (i === 0) {
                    roomPlayers.push({ id: idName, name: matchGroup[0].data.name, gender: gender, personality: "Chiến thuật gia", rank: matchGroup[0].data.stars });
                } else {
                    roomPlayers.push({ id: idName, name: `ThànhVên_${Math.floor(100 + Math.random() * 900)}`, gender: gender, personality: getRandomPersonality(), rank: 'Kim Cương' });
                }
            }

            matchGroup[0].socket.join(randomRoomID);
            io.to(randomRoomID).emit('match_started', { roomID: randomRoomID, players: roomPlayers });
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
