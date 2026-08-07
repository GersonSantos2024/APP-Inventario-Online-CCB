# Projeto Inventario Online

## Descrição
Aplicativo para inventário online (interface estática). Atualizações nesta branch "fix/security-and-csv":

Principais mudanças aplicadas
- Refatoração: movido JS e CSS inline para `src/app.js` e `src/styles.css`.
- Segurança: removida senha hard-coded; agora o usuário precisa configurar uma senha local na primeira execução (mitigação temporária). Em produção, implemente autenticação servidor-side (JWT/HTTP-only cookies, Firebase Auth, Auth0, etc.).
- CSP: atualização da meta Content-Security-Policy no `index.html` para reduzir uso de 'unsafe-inline'. Para produção, gere nonces ou hashes a partir do servidor.
- CSV: substituído parser caseiro por PapaParse (robusto, suporta aspas escapadas, multilinha, detecção de delimitador). Corrige perda de colunas.
- Eventos: substituição de `keypress` por `keydown` e garantia de registro único de listeners.
- Export: adicionado botão "Exportar CSV" (mais seguro para bases grandes). PDF mantido.
- Persistência: adicionado salvamento automático de progresso em `localStorage` para retomada.

### Como testar localmente
1. Clone o repositório e mude para a branch `fix/security-and-csv` (ou acesse o branch no GitHub):

   git fetch origin
   git checkout fix/security-and-csv

2. Abra `index.html` em um navegador moderno (Chrome/Firefox). Algumas funcionalidades (câmera) exigem HTTPS ou origem segura (localhost/HTTPS).

3. Fluxo rápido:
- Ao abrir, configure uma senha local quando solicitado (primeiro uso).
- Carregue o CSV de casas de oração e a base geral (ambos em CSV).
- Selecione a casa de oração e clique em "Iniciar Inventário".
- Use o leitor físico (campo) ou o modo mobile (câmera).
- Ao finalizar, exporte CSV ou PDF.

### Notas e limitações
- Autenticação ainda é client-side temporária (não segura) — não use em produção com dados sensíveis.
- CSP no `index.html` é um passo; para uma política forte use nonces/hashes e sirva scripts com esses nonces via servidor.
- A geração de PDF pode falhar/consumir muita memória em bases muito grandes; prefira Exportar CSV para volumes grandes.

### Próximos passos recomendados
- Integrar autenticação servidor-side (API simples + JWT ou Firebase Auth).
- Mover processamento pesado (geração de PDF grande) para backend, se disponível.
- Testes automáticos e validação de CSV com contrato (colunas esperadas).

