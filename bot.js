// Comando: /vetorizar
if (commandName === 'vetorizar') {
    await interaction.deferReply(); // Dá tempo à IA para processar o vetor sem expirar o comando

    const imagem = interaction.options.getAttachment('imagem');

    // Validação de formato
    if (!imagem.contentType.startsWith('image/')) {
        return interaction.editReply({ content: '❌ Por favor, envia um arquivo de imagem válido (PNG, JPG ou WEBP).' });
    }

    try {
        // Descarrega a imagem enviada pelo utilizador do Discord
        const responseImagem = await axios.get(imagem.url, { responseType: 'stream' });

        // Prepara os dados em formato Form para a API
        const form = new FormData();
        form.append('image', responseImagem.data);
        
        // Mantém em modo "test" para processar de forma gratuita
        form.append('mode', 'test'); 

        // Faz a chamada à API do Vectorizer.AI usando as variáveis que guardaste no Render
        const apiResponse = await axios.post('https://vectorizer.ai/api/v1/vectorize', form, {
            headers: {
                ...form.getHeaders(),
            },
            auth: {
                username: process.env.VECTORIZER_API_ID,
                password: process.env.VECTORIZER_API_SECRET
            },
            responseType: 'arraybuffer' // Garante que recebemos o ficheiro SVG em formato binário
        });

        // Envia o ficheiro vetorizado final de volta para o canal do Discord
        await interaction.editReply({
            content: `🎨 Aqui está a tua imagem vetorizada profissionalmente, ${interaction.user}!`,
            files: [{
                attachment: Buffer.from(apiResponse.data),
                name: 'resultado_vetorizado.svg'
            }]
        });

    } catch (error) {
        console.error('Erro ao vetorizar imagem:', error);
        
        // Reporta o erro automaticamente no teu canal de logs críticos
        if (typeof reportarErroCritico === 'function') {
            reportarErroCritico('API Vectorizer.AI /vetorizar', error);
        }

        return interaction.editReply({ content: '❌ Ocorreu um erro ao tentar processar e vetorizar esta imagem com a IA.' });
    }
}
