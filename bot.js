const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const http = require('http'); 

// Configurações principais puxadas do seu painel do Render
const OWNER_ID = '1522577752916496476';
const TOKEN = process.env.TOKEN; 

// Suas chaves do Vectorizer.AI inseridas diretamente
const VECTORIZER_API_ID = 'vkvqc2s3evqv89a';
const VECTORIZER_API_SECRET = 'hnq4d5kftg2m579bnsbeddujma2qlpadmm6fkquohi07lbivdh15';

// -----------------------------------------------------------------
// SERVIDOR HTTP PARA O UPTIMEROBOT PINGAR (Evita sleep no Render)
// -----------------------------------------------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Metalbot Ativo 24/7 - Sistema de Mencao Otimizado\n');
}).listen(PORT, () => {
    console.log(`Servidor HTTP ativo na porta ${PORT}. Pronto para receber pings!`);
});
// -----------------------------------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // Ativa a leitura do conteúdo das mensagens
    ]
});

let logChannelId = null;

// Evento quando o bot conecta no Discord
client.once('ready', async () => {
    console.log(`Bot logado com sucesso como: ${client.user.tag}`);
    console.log('Sistema pronto! Escutando marcas com @ para vetorizacao direta.');

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
            await owner.send(`🟢 **Notificação do Sistema:** O bot está online no Render! Monitoramento por menção ativo.${msgConvite}`);
        }
    } catch (dmError) {
        console.error(`Não foi possível enviar DM para o Owner.`, dmError);
    }
});

// MONITORAMENTO DE MENSAGENS (Substitui os comandos barra)
client.on('messageCreate', async (message) => {
    // Ignora mensagens do próprio bot
    if (message.author.bot) return;

    // Verifica se o bot foi mencionado na mensagem
    if (message.mentions.has(client.user)) {
        
        // Pega a imagem anexada na mensagem
        const imagem = message.attachments.first();

        // Se marcou o bot mas não mandou nenhuma imagem
        if (!imagem) {
            return message.reply('❌ Você precisa me marcar e **anexar uma imagem** (PNG ou JPG) na mesma mensagem para eu vetorizar!');
        }

        // Verifica se o arquivo enviado é realmente uma imagem
        if (!imagem.contentType || !imagem.contentType.startsWith('image/')) {
            return message.reply('❌ O arquivo enviado não é uma imagem válida. Envie um PNG ou JPG.');
        }

        // Avisa que começou a trabalhar na imagem
        const msgAviso = await message.reply('🎨 Entendido! Baixando sua imagem e iniciando o processo de vetorização profissional com fundo transparente...');

        try {
            // 1. Baixa a imagem do servidor do Discord
            const responseImagem = await axios.get(imagem.url, { responseType: 'stream' });
            
            // 2. Prepara o formulário para enviar para a IA
            const form = new FormData();
            form.append('image', responseImagem.data);
            
            // CONFIGURAÇÃO DA IA: Força o processamento completo focado em alta qualidade de elementos
            form.append('mode', 'production'); 

            console.log(`Enviando imagem de ${message.author.tag} para a API do Vectorizer.AI...`);

            // 3. Faz a requisição na API do Vectorizer.AI
            const apiResponse = await axios.post('https://vectorizer.ai/api/v1/vectorize', form, {
                headers: { ...form.getHeaders() },
                auth: {
                    username: VECTORIZER_API_ID,
                    password: VECTORIZER_API_SECRET
                },
                responseType: 'arraybuffer' // Recebe o arquivo SVG puro de volta
            });

            // 4. Apaga a mensagem de aviso e envia o resultado final
            await msgAviso.delete().catch(() => {});
            
            await message.reply({
                content: `✅ **Vetorização concluída com sucesso, ${message.author}!** Elementos separados e fundo convertido em transparente (SVG).`,
                files: [{ attachment: Buffer.from(apiResponse.data), name: 'resultado_transparente.svg' }]
            });

            console.log('SVG gerado e entregue com sucesso!');

        } catch (error) {
            console.error('Erro ao processar na API:', error.message);
            await msgAviso.delete().catch(() => {});
            
            if (logChannelId) reportarErroCritico('API Vectorizer.AI', error);
            
            return message.reply('❌ Ocorreu um erro ao processar os elementos na IA do Vectorizer. Verifique se a imagem original não está corrompida.');
        }
    }
});

// Sistema de captura e relatório de erros
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
