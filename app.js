const express = require('express')
const path = require('path')
const node_fetch = require('node-fetch')
const bodyParser = require('body-parser')
const stream = require('stream')
const { SocksProxyAgent } = require('socks-proxy-agent')
const app = express()
app.use(bodyParser.urlencoded({ extended: false }))
// 解析 application/json 格式的请求体
app.use(bodyParser.json())

app.use(express.static(path.resolve(__dirname, "./public")))
function formatTime (fmt = 'yyyy-MM-dd HH:mm:ss', timeDate) {
    const date = timeDate ? timeDate : new Date()
    const add0 = (num) => num < 10 ? `0${num}` : num
    const o = {
        'yyyy': date.getFullYear(),
        'MM': add0(date.getMonth() + 1),
        'dd': add0(date.getDate()),
        'HH': add0(date.getHours()),
        'mm': add0(date.getMinutes()),
        'ss': add0(date.getSeconds()),
        'qq': Math.floor((date.getMonth() + 3) / 3),
        'S': date.getMilliseconds() //毫秒
    }
    Object.keys(o).forEach((i) => {
        if (fmt.includes(i)) {
            fmt = fmt?.replace(i, o[i])
        }
    })
    return fmt
}
//处理chatGpt传回的数据
function handleOpenChatData (chunk, parentMessageId) {
    // 将字符串按照连续的两个换行符进行分割
    let chunks = chunk.toString().split(/\n{2}/g)
    // 过滤掉空白的消息
    chunks = chunks.filter((item) => item.trim())
    const contents = []
    for (let i = 0; i < chunks.length; i++) {
        const message = chunks[i]
        let payload = message.replace(/^data: /, '')
        if (payload === '[DONE]') {
            contents.push(JSON.stringify({
                id: '',
                role: 'assistant',
                segment: 'stop',
                dateTime: formatTime(),
                content: '',
                parentMessageId
            }))
        }
        try {
            payload = JSON.parse(payload)
        }
        catch (e) {
            // 忽略无法解析为 JSON 的消息
            continue
        }
        const payloadContent = payload.choices?.[0]?.delta?.content || ''
        const payloadRole = payload.choices?.[0]?.delta?.role
        const segment = payload === '[DONE]' ? 'stop' : payloadRole === 'assistant' ? 'start' : 'text'
        contents.push(JSON.stringify({
            id: payload.id,
            role: 'assistant',
            segment,
            dateTime: formatTime(),
            content: payloadContent,
            parentMessageId
        }) + '\n\n')
    }
    return contents.join('')
}
const chatGptKey = '你的key'
//代理
const socksProxyAgentHostname = ''
const socksProxyAgentHostPort = ''
//处理前端请求
app.post('/chat', async (req, res) => {
    const { prompt, parentMessageId } = req.body
    const messages = [
        {
            role: 'user',
            content: prompt
        }
    ]
    let options = {
        method: 'POST',
        body: JSON.stringify({
            frequency_penalty: 0,
            model: 'gpt-3.5-turbo',
            presence_penalty: 0,
            temperature: 0,
            messages,
            //开启流传输
            stream: true
        }),
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${chatGptKey}`
        }
    }
    if (socksProxyAgentHostname && socksProxyAgentHostPort) {
        //本地代理，外网无需使用
        const agent = new SocksProxyAgent({
            hostname: '127.0.0.1',
            port: '7890',
        })
        options = { ...options, agent }
    }
    console.log(options)
    try {
        const chat = await node_fetch(`https://api.openai.com/v1/chat/completions`, options)
        let content = ''
        if (chat.status === 200 && chat.headers.get('content-type')?.includes('text/event-stream')) {
            res.setHeader('Content-Type', 'text/event-stream;charset=utf-8')
            //处理数据
            const jsonStream = new stream.Transform({
                objectMode: true,
                transform (chunk, encoding, callback) {
                    const bufferString = Buffer.from(chunk).toString()
                    const listString = handleOpenChatData(bufferString, parentMessageId)
                    const list = listString.split('\n\n')
                    for (let i = 0; i < list.length; i++) {
                        if (list[i]) {
                            const jsonData = JSON.parse(list[i])
                            if (jsonData.segment === 'stop') {
                                console.log(content)
                                /**
                                * TODO
                                * 结束后还需要进行数据库操作，例如：消息存数据库，扣费等操作
                                */

                            }
                            else {
                                content += jsonData.content
                            }
                        }
                    }
                    callback(null, listString)

                }
            })

            chat.body.pipe(jsonStream).pipe(res)
            return
        }
        const data = await chat.json()
        res.status(chat.status).json(data)
    } catch (error) {
        console.log(error)
    }

})
app.listen('3001', () => {
    console.log(`服务器启动成功, http://localhost:3001/`)
})