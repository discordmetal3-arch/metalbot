const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http'); 

const OWNER_ID = '1522577752916496476';
const TOKEN = process.env.TOKEN; 

const VECTORIZER_API_ID = 'vkvqc2s3evqv89a';
const VECTORIZER_API_SECRET = 'hnq4d5kftg2m579bnsbeddujma2qlpadmm6fkquohi07lbivdh15';

// Servidor HTTP para o UptimeRobot bater
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Metalbot Ativo 24/7\n');
}).listen(PORT);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

client.once('ready', () => {
    console.log(`Bot logado como: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.mentions.has(client.user)) {
        const imagem = message.attachments.first();

        if (!imagem) {
            return message.reply('❌ Você precisa me marcar e **anexar uma imagem** (PNG ou JPG) para eu vetorizar!');
        }

        const msgAviso = await message.reply('🎨 Baixando imagem e separando elementos com fundo transparente...');

        try {
            // Baixa os dados da imagem em formato de buffer para não dar erro de tamanho ou timeout
            const responseImagem = await axios.get(imagem.url, { responseType: 'arraybuffer' });
            
            const form = new FormData();
            // Passa o buffer direto com o nome do arquivo correto
            form.append('image', Buffer.from(responseImagem.data), {
                filename: imagem.name || 'image.png',
                contentType: imagem.contentType
            });

            console.log(`Vetorizando imagem de ${message.author.tag}...`);

            const apiResponse = await axios.post('https://vectorizer.ai/api/v1/vectorize', form, {
                headers: { ...form.getHeaders() },
                auth: {
                    username: VECTORIZER_API_ID,
                    password: VECTORIZER_API_SECRET
                },
                responseType: 'arraybuffer'
            });

            await msgAviso.delete().catch(() => {});
            
            await message.reply({
                content: `✅ **Vetorização concluída, ${message.author}!** Fundo transparente aplicado.`,
                files: [{ attachment: Buffer.from(apiResponse.data), name: 'resultado_transparente.svg' }]
            });

        } catch (error) {
            console.error('Erro na API:', error.response ? error.response.status : error.message);
            await msgAviso.delete().catch(() => {});
            return message.reply('❌ A IA do Vectorizer não conseguiu processar essa imagem. Tente enviar um arquivo PNG/JPG menor ou converta o print direto antes de mandar.');
        }
    }
});

client.login(TOKEN);
