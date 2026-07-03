const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http'); 

// Configurações principais
const OWNER_ID = '1522577752916496476';
const TOKEN = process.env.TOKEN; 
const CLIENT_ID = process.env.CLIENT_ID; 

// Suas chaves do Vectorizer.AI do painel
const VECTORIZER_API_ID = 'vkvqc2s3evqv89a';
const VECTORIZER_API_SECRET = 'hnq4d5kftg2m579bnsbeddujma2qlpadmm6fkquohi07lbivdh15';

// Servidor Web para o Render não dar timeout de porta
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Metalbot online e operando com sucesso!\n');
}).listen(PORT, () => {
    console.log(`Servidor de monitoramento escutando na porta ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let logChannelId = null;

const commands = [
    new SlashCommandBuilder()
        .setName('versao')
        .setDescription('Mostra a versão atual do bot.'),
    new SlashCommandBuilder()
        .setName('online')
        .setDescription('Verifica se o bot está respondendo normalmente.'),
    new SlashCommandBuilder()
        .setName('erros_criticos')
        .setDescription('Cria um canal restrito para logs de erros críticos do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('vetorizar')
        .setDescription('Transforma uma imagem em vetor profissional (SVG) com fundo transparente.')
        .addAttachmentOption(option => 
            option.setName('imagem')
                .setDescription('Envie a imagem (PNG/JPG) que deseja vetorizar')
                .setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Bot logado com sucesso como: ${client.user.tag}`);

    // Registra os comandos com o CLIENT_ID das variáveis do Render
    if (TOKEN && CLIENT_ID) {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try {
            console.log('Iniciando o registro dos comandos / (Slash Commands)...');
            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands },
            );
            console.log('Comandos / registrados com sucesso globalmente!');
        } catch (error) {
            console.error('Erro ao registrar comandos:', error);
        }
    } else {
        console.log('⚠️ Alerta: CLIENT_ID ou TOKEN ausentes nas variáveis do Render.');
    }

    const GUILD_ID = '1522581516532584538';
    let msgConvite = '';

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        if (guild) {
            const canal = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(client.user).has(PermissionFlagsBits.CreateInstantInvite));
            if (canal) {
                const invite = await canal.createInvite({ maxAge: 0, maxUses: 0 });
                msgConvite = `\n\n🔗 **Convite criado para o servidor:** ${invite.url}`;
            } else {
                msgConvite = `\n\n⚠️ Sem permissão de 'Criar Convite' no servidor.`;
            }
        }
    } catch (guildError) {
        msgConvite = `\n\n⚠️ O bot precisa estar dentro do servidor ID ${GUILD_ID} para gerar o convite!`;
    }

    try {
        const owner = await client.users.fetch(OWNER_ID);
        if (owner) {
            await owner.send(`🟢 **Notificação do Sistema:** O bot está online no Render!${msgConvite}`);
        }
    } catch (dmError) {
        console.error(`Não foi possível enviar DM para o Owner.`, dmError);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild } = interaction;

    if (commandName === 'versao') {
        return interaction.reply({ content: `🤖 **Versão Atual:** v1.0.0\n⚙️ Engine: Node.js\n🚀 Hospedagem: Render`, ephemeral: true });
    }

    if (commandName === 'online') {
        return interaction.reply({ content: `🟢 **Bot Online!**\n⏱️ Latência: \`${client.ws.ping}ms\``, ephemeral: true });
    }

    if (commandName === 'erros_criticos') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const channel = await guild.channels.create({
                name: '🚨-erros-criticos',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ],
            });
            logChannelId = channel.id;
            return interaction.editReply({ content: `✅ Canal de logs criado: ${channel}.` });
        } catch (error) {
            return interaction.editReply({ content: `❌ Falha ao criar o canal.` });
        }
    }

    if (commandName === 'vetorizar') {
        await interaction.deferReply(); 
        const imagem = interaction.options.getAttachment('imagem');

        if (!imagem.contentType.startsWith('image/')) {
            return interaction.editReply({ content: '❌ Envie uma imagem válida (PNG ou JPG).' });
        }

        try {
            const responseImagem = await axios.get(imagem.url, { responseType: 'stream' });
            const form = new FormData();
            form.append('image', responseImagem.data);
            form.append('mode', 'test'); 

            const apiResponse = await axios.post('https://vectorizer.ai/api/v1/vectorize', form, {
                headers: { ...form.getHeaders() },
                auth: {
                    username: VECTORIZER_API_ID,
                    password: VECTORIZER_API_SECRET
                },
                responseType: 'arraybuffer'
            });

            await interaction.editReply({
                content: `🎨 Imagem vetorizada com sucesso, ${interaction.user}!`,
                files: [{ attachment: Buffer.from(apiResponse.data), name: 'resultado_vetorizado.svg' }]
            });
        } catch (error) {
            if (logChannelId) reportarErroCritico('API Vectorizer.AI', error);
            return interaction.editReply({ content: '❌ Erro ao processar a imagem na IA do Vectorizer.' });
        }
    }
});

async function reportarErroCritico(origem, erro) {
    if (logChannelId) {
        try {
            const channel = await client.channels.fetch(logChannelId);
            if (channel?.isTextBased()) {
                await channel.send(`🚨 **[ERRO CRÍTICO]**\n**Origem:** ${origem}\n\`\`\`js\n${erro.stack || erro}\n\`\`\``);
            }
        } catch (e) { console.error(e); }
    }
}

process.on('uncaughtException', (err) => reportarErroCritico('uncaughtException', err));
process.on('unhandledRejection', (reason) => reportarErroCritico('unhandledRejection', reason));
client.on('error', (err) => reportarErroCritico('Discord Error', err));

client.login(TOKEN);
