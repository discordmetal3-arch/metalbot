const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http');

const TOKEN                 = process.env.TOKEN;
const CLIENT_ID             = process.env.CLIENT_ID;
const VECTORIZER_API_ID     = process.env.VECTORIZER_API_ID;
const VECTORIZER_API_SECRET = process.env.VECTORIZER_API_SECRET;

if (!TOKEN)                  throw new Error('Faltando variável de ambiente: TOKEN');
if (!CLIENT_ID)              throw new Error('Faltando variável de ambiente: CLIENT_ID');
if (!VECTORIZER_API_ID)      throw new Error('Faltando variável de ambiente: VECTORIZER_API_ID');
if (!VECTORIZER_API_SECRET)  throw new Error('Faltando variável de ambiente: VECTORIZER_API_SECRET');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Metalbot Ativo 24/7\n');
}).listen(PORT, () => console.log(`HTTP keepalive na porta ${PORT}`));

const commands = [
    new SlashCommandBuilder()
        .setName('vetorizar')
        .setDescription('Vetoriza uma imagem PNG/JPG para SVG editável no CorelDraw')
        .addAttachmentOption(option =>
            option
                .setName('imagem')
                .setDescription('Imagem PNG ou JPG para vetorizar')
                .setRequired(true)
        )
        .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registrarComandos() {
    try {
        console.log('Registrando slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash commands registrados com sucesso!');
    } catch (err) {
        console.error('Erro ao registrar slash commands:', err);
    }
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
    console.log(`✅ Bot logado como: ${client.user.tag}`);
    await registrarComandos();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'vetorizar') return;

    // CRÍTICO: responde em menos de 3s para não dar "O aplicativo não respondeu"
    await interaction.deferReply();

    const imagem = interaction.options.getAttachment('imagem');

    const nome = (imagem.name || '').toLowerCase();
    const tipoValido =
        (imagem.contentType && (
            imagem.contentType.includes('image/png') ||
            imagem.contentType.includes('image/jpeg')
        )) ||
        nome.endsWith('.png') ||
        nome.endsWith('.jpg') ||
        nome.endsWith('.jpeg');

    if (!tipoValido) {
        return interaction.editReply('❌ Formato inválido. Envie apenas **PNG** ou **JPG**.');
    }

    try {
        console.log(`[${new Date().toISOString()}] Vetorizando para ${interaction.user.tag}...`);
        const responseImagem = await axios.get(imagem.url, {
            responseType: 'arraybuffer',
            timeout: 30000,
        });

        const form = new FormData();
        form.append('image', Buffer.from(responseImagem.data), {
            filename: imagem.name || 'image.png',
            contentType: imagem.contentType || 'image/png',
        });

        form.append('output.group_by', 'color');
        form.append('processing.max_colors', '256');
        form.append('output.curves.line_straighten', '0');
        form.append('output.curves.splice_threshold', '0.5');
        form.append('output.size.scale', '1.0');

        console.log(`[${new Date().toISOString()}] Enviando para Vectorizer.ai...`);

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

        const svgBuffer = Buffer.from(apiResponse.data);
        const tamanhoMB = svgBuffer.length / (1024 * 1024);

        if (tamanhoMB > 8) {
            return interaction.editReply(
                '⚠️ O SVG gerado passou de 8 MB (limite do Discord).\n' +
                'Tente enviar uma imagem com menos detalhes ou resolução menor.'
            );
        }

        await interaction.editReply({
            content:
                `✅ **Vetorização concluída!**\n` +
                `📐 Elementos agrupados por cor — abra o SVG no **CorelDraw** e cada cor estará como objeto separado e editável.\n` +
                `📁 Tamanho: ${tamanhoMB.toFixed(2)} MB`,
            files: [{ attachment: svgBuffer, name: 'vetor_corel.svg' }],
        });

    } catch (error) {
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

            if (status === 401) return interaction.editReply('❌ Credenciais da API inválidas. Verifique `VECTORIZER_API_ID` e `VECTORIZER_API_SECRET` no Render.');
            if (status === 402) return interaction.editReply('❌ Créditos da conta Vectorizer.ai esgotados. Recarregue em vectorizer.ai.');
            if (status === 413) return interaction.editReply('❌ Imagem muito grande. Envie uma imagem menor que 10 MB.');
            if (status === 429) return interaction.editReply('❌ Limite de requisições atingido. Aguarde e tente novamente.');
        } else if (error.code === 'ECONNABORTED') {
            return interaction.editReply('❌ A API demorou mais de 2 minutos. Tente uma imagem menor.');
        }

        return interaction.editReply(
            `❌ Falha na vetorização: **${detalheErro || error.message}**\n` +
            'Dicas: envie PNG/JPG com fundo simples, tamanho até 5 MB.'
        );
    }
});

client.login(TOKEN);
