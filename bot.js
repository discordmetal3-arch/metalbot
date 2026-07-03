const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http');

// ─── Configurações ────────────────────────────────────────────────────────────
const TOKEN                = process.env.TOKEN;
const VECTORIZER_API_ID    = process.env.VECTORIZER_API_ID;
const VECTORIZER_API_SECRET = process.env.VECTORIZER_API_SECRET;

if (!TOKEN)                  throw new Error('Faltando variável de ambiente: TOKEN');
if (!VECTORIZER_API_ID)     throw new Error('Faltando variável de ambiente: VECTORIZER_API_ID');
if (!VECTORIZER_API_SECRET) throw new Error('Faltando variável de ambiente: VECTORIZER_API_SECRET');

// Servidor HTTP para UptimeRobot / Render keepalive
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Metalbot Ativo 24/7\n');
}).listen(PORT, () => console.log(`HTTP keepalive na porta ${PORT}`));

// ─── Cliente Discord ──────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`✅ Bot logado como: ${client.user.tag}`);
});

// ─── Evento de mensagem ───────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.mentions.has(client.user)) return;

    const imagem = message.attachments.first();

    if (!imagem) {
        return message.reply(
            '❌ Você precisa me marcar **e anexar uma imagem** (PNG ou JPG) para eu vetorizar!\n' +
            'Exemplo: `@Metalbot` + imagem em anexo'
        );
    }

    // Verifica se é PNG ou JPG
    const nomeArquivo = (imagem.name || '').toLowerCase();
    const tipoValido  = imagem.contentType &&
                        (imagem.contentType.includes('image/png') ||
                         imagem.contentType.includes('image/jpeg') ||
                         imagem.contentType.includes('image/jpg') ||
                         nomeArquivo.endsWith('.png') ||
                         nomeArquivo.endsWith('.jpg') ||
                         nomeArquivo.endsWith('.jpeg'));

    if (!tipoValido) {
        return message.reply('❌ Formato inválido. Envie apenas **PNG** ou **JPG**.');
    }

    const msgAviso = await message.reply(
        '⏳ Processando vetorização com separação de elementos por cor...\n' +
        'Isso pode levar até 30 segundos dependendo da complexidade da imagem.'
    );

    try {
        // 1. Baixa a imagem
        console.log(`[${new Date().toISOString()}] Baixando imagem de ${message.author.tag}...`);
        const responseImagem = await axios.get(imagem.url, {
            responseType: 'arraybuffer',
            timeout: 30000,
        });

        // 2. Monta o FormData com parâmetros otimizados para CorelDraw
        const form = new FormData();
        form.append('image', Buffer.from(responseImagem.data), {
            filename: imagem.name || 'image.png',
            contentType: imagem.contentType || 'image/png',
        });

        // Agrupa caminhos por cor → cada cor vira um objeto separado no CorelDraw
        form.append('output.group_by', 'color');

        // Até 256 cores distintas → mais camadas de cor para selecionar individualmente
        form.append('processing.max_colors', '256');

        // Curvas Bézier de alta precisão → traços mais limpos para editar
        form.append('output.curves.line_straighten', '0');
        form.append('output.curves.splice_threshold', '0.5');

        // Escala livre no CorelDraw
        form.append('output.size.scale', '1.0');

        // Caminhos vetoriais puros (sem bitmap embutido)
        form.append('output.bitmap_dpi', '150');

        console.log(`[${new Date().toISOString()}] Enviando para Vectorizer.ai...`);

        // 3. Chama a API do Vectorizer.ai
        const apiResponse = await axios.post(
            'https://vectorizer.ai/api/v1/vectorize',
            form,
            {
                headers: { ...form.getHeaders() },
                auth: {
                    username: VECTORIZER_API_ID,
                    password: VECTORIZER_API_SECRET,
                },
                responseType: 'arraybuffer',
                timeout: 120000,
            }
        );

        // 4. Verifica o tamanho (Discord limita a 8 MB)
        const svgBuffer = Buffer.from(apiResponse.data);
        const tamanhoMB = svgBuffer.length / (1024 * 1024);
        console.log(`[${new Date().toISOString()}] SVG gerado: ${tamanhoMB.toFixed(2)} MB`);

        if (tamanhoMB > 8) {
            await msgAviso.edit(
                '⚠️ O SVG gerado passou de 8 MB (limite do Discord).\n' +
                'Tente enviar uma imagem com menos detalhes ou resolução menor.'
            );
            return;
        }

        await msgAviso.delete().catch(() => {});

        await message.reply({
            content:
                `✅ **Vetorização concluída, ${message.author}!**\n` +
                `📐 Elementos agrupados por cor — abra o SVG no **CorelDraw** e cada cor estará como objeto separado e editável.\n` +
                `📁 Tamanho: ${tamanhoMB.toFixed(2)} MB`,
            files: [{ attachment: svgBuffer, name: 'vetor_corel.svg' }],
        });

        console.log(`[${new Date().toISOString()}] ✅ Sucesso para ${message.author.tag}`);

    } catch (error) {
        await msgAviso.delete().catch(() => {});

        let detalheErro = '';
        if (error.response) {
            const status = error.response.status;
            try {
                const corpo = Buffer.from(error.response.data).toString('utf-8');
                const json  = JSON.parse(corpo);
                detalheErro = json.error_message || json.message || corpo;
            } catch {
                detalheErro = `HTTP ${status}`;
            }

            console.error(`[ERRO API] Status ${status}: ${detalheErro}`);

            if (status === 401) return message.reply('❌ Credenciais da API inválidas. Verifique `VECTORIZER_API_ID` e `VECTORIZER_API_SECRET` no Render.');
            if (status === 402) return message.reply('❌ Créditos da conta Vectorizer.ai esgotados. Recarregue em vectorizer.ai.');
            if (status === 413) return message.reply('❌ Imagem muito grande para a API. Envie uma imagem menor que 10 MB.');
            if (status === 429) return message.reply('❌ Limite de requisições atingido. Aguarde alguns segundos e tente novamente.');
        } else if (error.code === 'ECONNABORTED') {
            console.error('[ERRO] Timeout na requisição');
            return message.reply('❌ A API demorou mais de 2 minutos. Tente uma imagem menor ou com menos detalhes.');
        } else {
            console.error('[ERRO]', error.message);
        }

        return message.reply(
            `❌ Falha na vetorização: **${detalheErro || error.message}**\n` +
            'Dicas: envie PNG/JPG com fundo simples, tamanho até 5 MB, e evite fotos muito detalhadas.'
        );
    }
});

client.login(TOKEN);
