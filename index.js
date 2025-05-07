// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

// Importa as dependências necessárias
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'); // Biblioteca do WhatsApp
const qrcode = require('qrcode-terminal'); // Para mostrar QR Code no terminal
const { createClient } = require('@supabase/supabase-js'); // Cliente do Supabase
const fs = require('fs'); // Para manipulação de arquivos
const path = require('path'); // Para trabalhar com caminhos de arquivos

// === Configuração do Supabase ===
// Obtém URL e chave do Supabase das variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// Cria o cliente do Supabase para interagir com o banco de dados
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === Configuração do WhatsApp ===
// Cria uma nova instância do cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(), // Usa autenticação local (armazena sessão)
  puppeteer: {
    headless: true, // Executa em modo headless (sem interface gráfica)
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Argumentos de segurança
  }
});

// Evento disparado quando precisa autenticar via QR Code
client.on('qr', (qr) => {
  // Gera e exibe o QR Code no terminal
  qrcode.generate(qr, { small: true });
});

// Evento disparado quando o cliente está pronto
client.on('ready', async () => {
  console.log('✅ Conectado ao WhatsApp');
  // Inicia o loop principal de envio de mensagens
  await loopDeEnvio();
});

// === Função principal - Loop infinito de envio ===
async function loopDeEnvio() {
  // Loop infinito para verificar constantemente por novos contatos
  while (true) {
    // Busca contatos no Supabase onde status é true e data_envio é null
    const { data: contatos, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('status', true) // Filtra por status=true
      .is('data_envio', null); // Filtra por data_envio não preenchida

    // Tratamento de erro na consulta
    if (error) {
      console.error('❌ Erro ao buscar contatos:', error);
      await delay(10000); // Espera 10 segundos antes de tentar novamente
      continue;
    }

    // Se não encontrou contatos para enviar
    if (!contatos.length) {
      console.log('📭 Nenhum contato para enviar. Verificando novamente em 30 segundos...');
      await delay(30000); // Espera 30 segundos antes de verificar novamente
      continue;
    }

    // Monta os caminhos para os arquivos de conteúdo
    const imagemPath = path.join(__dirname, 'conteudo', 'Picanha.png'); // Caminho da imagem
    const mensagemPath = path.join(__dirname, 'conteudo', 'mensagem.txt'); // Caminho do texto
    const imagem = MessageMedia.fromFilePath(imagemPath); // Carrega a imagem
    const legenda = fs.readFileSync(mensagemPath, 'utf8'); // Lê o arquivo de texto

    // Processa cada contato encontrado
    for (const contato of contatos) {
      // Gera variações do número de telefone (com/sem 9 após DDD)
      const tentativas = gerarNumerosAlternativos(contato.telefone);
      let enviado = false; // Flag para controlar se o envio foi bem-sucedido

      // Tenta enviar para cada variação do número
      for (const numero of tentativas) {
        try {
          // Verifica se o número existe no WhatsApp
          const valido = await client.getNumberId(numero);
          if (!valido) continue; // Se inválido, tenta a próxima variação

          // Formata o número para o padrão do WhatsApp
          const numeroWhatsApp = numero + '@c.us';
          // Envia a mensagem (imagem com legenda)
          await client.sendMessage(numeroWhatsApp, imagem, { caption: legenda });
          console.log(`✅ Mensagem enviada para ${numero}`);

          // Atualiza o contato no Supabase marcando como enviado
          await supabase
            .from('contacts')
            .update({
              data_envio: new Date().toISOString(), // Data/hora atual
              mensagem: legenda // Texto enviado
            })
            .eq('id', contato.id); // Filtra pelo ID do contato

          enviado = true; // Marca como enviado
          break; // Sai do loop de tentativas
        } catch (err) {
          // Se ocorrer erro no envio
          console.error(`❌ Erro ao enviar para ${numero}:`, err.message);
        }
      }

      // Se não conseguiu enviar para nenhuma variação do número
      if (!enviado) {
        console.warn(`⚠️ Não foi possível enviar para ${contato.telefone}`);

        // Atualiza o contato no Supabase marcando o erro
        await supabase
          .from('contacts')
          .update({
            data_envio: new Date().toISOString(), // Data/hora atual
            mensagem: 'Erro: número inválido ou não encontrado no WhatsApp' // Mensagem de erro
          })
          .eq('id', contato.id); // Filtra pelo ID do contato
      }

      // Aguarda um tempo aleatório entre 10 e 30 segundos antes do próximo envio
      await delayAleatorio();
    }
  }
}

// === Função para gerar variações de números de telefone ===
function gerarNumerosAlternativos(telefone) {
  // Remove tudo que não for dígito
  const limpo = telefone.replace(/\D/g, '');
  
  // Se o número for muito curto, retorna array vazio
  if (limpo.length < 10) return [];

  // Extrai o DDD (2 primeiros dígitos)
  const ddd = limpo.slice(0, 2);
  // Pega o restante do número (após DDD)
  const corpo = limpo.slice(2);

  // Gera variações com e sem o 9 na frente
  const com9 = corpo.startsWith('9') ? corpo : '9' + corpo;
  const sem9 = corpo.startsWith('9') ? corpo.slice(1) : corpo;

  // Retorna as variações com código do Brasil (55) + DDD + número
  return [`55${ddd}${sem9}`, `55${ddd}${com9}`];
}

// === Função para delay fixo ===
function delay(ms) {
  // Retorna uma Promise que resolve após 'ms' milissegundos
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Função para delay aleatório entre 10 e 30 segundos ===
function delayAleatorio() {
  // Gera um número aleatório entre 10000 e 30000 (10-30 segundos)
  const tempo = Math.floor(Math.random() * (30000 - 10000 + 1)) + 10000;
  // Usa a função delay com o tempo aleatório gerado
  return delay(tempo);
}

// Inicializa o cliente WhatsApp
client.initialize();