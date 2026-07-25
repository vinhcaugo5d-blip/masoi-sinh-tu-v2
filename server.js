// Hàm gọi Qwen-72B thông qua Cloud API - Bản Chuẩn Hóa An Toàn 100%
async function callQwen72BAPI(bot, playersContext) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // Timeout 8s cho Cloud API

    try {
        // Chỉ lọc các trường thông tin tối giản để tiết kiệm token đầu vào (Context Token)
        const simplifiedContext = playersContext.map(p => ({
            slot: p.slotID,
            alive: p.isAlive
        }));

        let prompt = `Bạn là một người chơi thông minh (mã số ${bot.slotID}, giới tính ${bot.gender}, rank Chiến Thần) trong game Ma Sói Sinh Tử 12 người. 
Vai trò bí mật của bạn là: ${bot.role}. 
Trạng thái các người chơi hiện tại: ${JSON.stringify(simplifiedContext)}.
Hãy viết một câu phát biểu ngắn gọn (dưới 30 từ) bằng tiếng Việt để biện luận hoặc định hướng vote. Không lan man.`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ĐIỀN_API_KEY_CỦA_BẠN_VÀO_ĐÂY' // Thay API Key thực tế của bạn vào đây
            },
            body: JSON.stringify({
                model: 'qwen/qwen-2.5-72b-instruct', // Khuyên dùng bản Qwen 2.5 mới nhất suy luận cực bén
                messages: [
                    { 
                        role: 'system', 
                        content: 'Bạn là một người chơi board game Ma Sói sắc sảo, rank Chiến Thần. Hãy trả lời trực tiếp câu thoại, không thêm tiền tố như "Bot:", "Ô số X:" hay giải thích gì thêm.' 
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8, // Tăng nhẹ một chút để Bot có văn phong đa dạng qua các vòng
                max_tokens: 60    // Đã tối ưu hạ xuống 60 token để tiết kiệm chi phí và ép AI nói ngắn gọn
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();
        
        // SỬA LỖI: Trích xuất nội dung chuẩn xác theo cấu trúc mảng của OpenAI API
        if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
            return data.choices[0].message.content.trim();
        }
        return "Tôi đang phân tích lại nhịp độ vote của mọi người...";

    } catch (error) {
        clearTimeout(timeoutId);
        // Fallback tự động khi gọi API Cloud bị lỗi mạng hoặc quá hạn (timeout)
        const fallbacks = [
            `Phân tích Chiến Thần: Ô ${bot.slotID} thấy luồng thông tin lượt trước có mâu thuẫn lớn, cần kiểm chứng kỹ.`,
            `Tôi là dân, lượt này khuyến nghị mọi người quan sát động thái của các ô ẩn mình từ đầu trận.`,
            `Nhịp độ vote hiện tại đang bất lợi cho phe thiện. Đề nghị giữ bình tĩnh, chưa vội theo số đông.`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}
