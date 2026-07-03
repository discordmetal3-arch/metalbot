// Evento: Bot Online
client.once('ready', async () => {
    console.log(`Bot logado com sucesso como: ${client.user.tag}`);

    const GUILD_ID = '1522581516532584538';
    let msgConvite = '';

    try {
        // Tenta buscar o servidor pelo ID fornecido
        const guild = await client.guilds.fetch(GUILD_ID);
        if (guild) {
            // Busca o primeiro canal de texto onde o bot possa criar um convite
            const canal = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(client.user).has(PermissionFlagsBits.CreateInstantInvite));
            
            if (canal) {
                const invite = await canal.createInvite({ maxAge: 0, maxUses: 0 }); // Convite infinito
                msgConvite = `\n\n🔗 **Convite para o servidor:** ${invite.url}`;
            } else {
                msgConvite = `\n\n⚠️ Não consegui criar o convite porque não achei um canal de texto com permissão de 'Criar Convite'.`;
            }
        }
    } catch (guildError) {
        msgConvite = `\n\n⚠️ Não consegui gerar o convite do servidor porque ainda não fui adicionado nele ou o ID está incorreto.`;
    }

    // Envia a notificação completa na sua DM
    try {
        const owner = await client.users.fetch(OWNER_ID);
        if (owner) {
            await owner.send(`🟢 **Notificação do Sistema:** O bot de vetorização profissional está online e operando no Render!${msgConvite}`);
            console.log(`Aviso de inicialização enviado para o ID ${OWNER_ID}`);
        }
    } catch (dmError) {
        console.error(`Não foi possível enviar DM para o Owner (${OWNER_ID}).`, dmError);
    }
});
