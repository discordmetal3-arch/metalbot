const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');

// Configurações principais puxadas do Render
const OWNER_ID = '1522577752916496476';
const TOKEN = process.env.TOKEN; 
const CLIENT_ID = process.env.CLIENT_ID || '1343759318856274020'; // Substitua pelo ID do seu bot se necessário

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Variável global para armazenar o canal de logs críticos
let logChannelId = null;

// Definição dos Comandos Slash
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

// Registro dos comandos na API do Discord
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
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
})();

// Evento: Bot Online
client.once('ready', async () => {
    console.log(`Bot logado com sucesso como: ${client.user.tag}`);

    // Envia mensagem na DM do Owner ID informado
    try {
        const owner = await client.users.fetch(OWNER_ID);
        if (owner) {
            await owner.send(`🟢 **Notificação do Sistema:** O bot de vetorização profissional está online e operando no Render!`);
            console.log(`Aviso de inicialização enviado para o ID ${OWNER_ID}`);
        }
    } catch (dmError) {
        console.error(`Não foi possível enviar DM para o Owner (${OWNER_ID}).`, dmError);
    }
});

// Gerenciador de Interações (Comandos)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guild } = interaction;

    // Comando: /versao
    if (commandName === 'versao') {
        return interaction.reply({ content: `🤖 **Versão Atual:** v1.0.0\n⚙️ Engine: Node.js\n🚀 Hospedagem: Render`, ephemeral: true });
    }

    // Comando: /online
    if (commandName === 'online') {
        const ping = client.ws.ping;
        return interaction.reply({ content: `🟢 **Bot Online e Operante!**\n⏱️ Latência da API: \`${ping}ms\``, ephemeral: true });
    }

    // Comando: /erros_criticos
    if (commandName === 'erros_criticos') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const channel = await guild.channels.create({
                name: '🚨-erros-criticos',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    }
                ],
            });

            logChannelId = channel.id;
            return interaction.editReply({ content: `✅ Canal de logs criado com sucesso: ${channel}.` });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: `❌ Falha ao criar o canal de logs.` });
        }
    }

    // Comando: /vetorizar
    if (commandName === 'vetorizar') {
        await interaction.deferReply(); 

        const imagem = interaction.options.getAttachment('imagem');

        if (!imagem.contentType.startsWith('image/')) {
            return interaction.editReply({ content: '❌ Por favor, envie um arquivo de imagem válido (PNG, JPG ou WEBP).' });
        }

        try {
            const responseImagem = await axios.get(imagem.url, { responseType: 'stream' });

            const form = new FormData();
            form.append('image', responseImagem.data);
            form.append('mode', 'test'); 

            const apiResponse = await axios.post('https://vectorizer.ai/api/v1/vectorize', form, {
                headers: {
                    ...form.getHeaders(),
                },
                auth: {
                    username: process.env.VECTORIZER_API_ID,
                    password: process.env.VECTORIZER_API_SECRET
                },
                responseType: 'arraybuffer'
            });

            await interaction.editReply({
                content: `🎨 Aqui está a sua imagem vetorizada profissionalmente, ${interaction.user}!`,
                files: [{
                    attachment: Buffer.from(apiResponse.data),
                    name: 'resultado_vetorizado.svg'
                }]
            });

        } catch (error) {
            console.error('Erro ao vetorizar imagem:', error);
            
            if (typeof reportarErroCritico === 'function') {
                reportarErroCritico('API Vectorizer.AI /vetorizar', error);
            }

            return interaction.editReply({ content: '❌ Ocorreu um erro ao tentar processar e vetorizar essa imagem com a IA.' });
        }
    }
});

// Captura de Erros Críticos do Processo Node e Envio de Alertas
async function reportarErroCritico(origem, erro) {
    console.error(`[ERRO CRÍTICO - ${origem}]:`, erro);
    
    if (logChannelId) {
        try {
            const channel = await client.channels.fetch(logChannelId);
            if (channel && channel.isTextBased()) {
                await channel.send({
                    content: `🚨 **[ERRO CRÍTICO DO SISTEMA]**\n**Origem:** ${origem}\n\`\`\`js\n${erro.stack || erro}\n\`\`\``
                });
            }
        } catch (e) {
            console.error('Falha ao enviar mensagem de erro para o canal de log:', e);
        }
    }
}

// Escutas globais de falhas do Node.js
process.on('uncaughtException', (err) => reportarErroCritico('uncaughtException', err));
process.on('unhandledRejection', (reason) => reportarErroCritico('unhandledRejection', reason));
client.on('error', (err) => reportarErroCritico('Discord Client Error', err));

// Login do Bot
client.login(TOKEN);
