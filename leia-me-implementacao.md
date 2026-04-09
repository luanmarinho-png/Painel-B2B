# MedCof B2B — Guia de Implementação do Sistema de Autenticação

Este guia explica o que foi modificado e os passos que você precisa seguir para ativar o sistema.

---

## O que foi modificado

| Arquivo | O que mudou |
|---|---|
| `admin.html` | Login substituído por Supabase Auth (e-mail + senha + role) |
| `*/shared.js` (todas as 6 instituições) | Acesso por senha fixa substituído por login/cadastro com verificação na whitelist do Supabase |
| `supabase-config.js` | **NOVO** — Arquivo central com as credenciais e funções do Supabase |
| `recuperar-senha.html` | **NOVO** — Página de recuperação de senha |
| `nova-senha.html` | **NOVO** — Página para criar nova senha após clicar no link do e-mail |
| `supabase-setup.sql` | **NOVO** — SQL para criar a tabela de whitelist no Supabase |

---

## Passo 1 — Criar a tabela no Supabase (obrigatório, 1 vez)

1. Acesse: https://supabase.com/dashboard/project/cvwwucxjrpsfoxarsipr/sql
2. Cole o conteúdo do arquivo `supabase-setup.sql` e clique em **Run**
3. A tabela `usuarios_autorizados` será criada automaticamente

---

## Passo 2 — Configurar a URL de redirecionamento no Supabase

1. Acesse: https://supabase.com/dashboard/project/cvwwucxjrpsfoxarsipr/auth/url-configuration
2. Em **Site URL**, coloque: `https://grupomedcof.org`
3. Em **Redirect URLs**, adicione:
   - `https://grupomedcof.org/nova-senha.html`
   - `https://grupomedcof.org/admin.html`

---

## Passo 3 — Criar o primeiro usuário Admin no Supabase

1. Acesse: https://supabase.com/dashboard/project/cvwwucxjrpsfoxarsipr/auth/users
2. Clique em **Invite user** ou **Add user**
3. Informe o e-mail e senha do admin
4. Após criar, clique no usuário e edite o campo **user_metadata** adicionando:
```json
{
  "role": "superadmin"
}
```

> Para criar usuários `admin` comuns, use `"role": "admin"` no metadata.

---

## Passo 4 — Adicionar usuários autorizados por instituição (whitelist)

Para liberar o acesso de um coordenador ou usuário a uma instituição:

1. Acesse: https://supabase.com/dashboard/project/cvwwucxjrpsfoxarsipr/editor
2. Clique na tabela `usuarios_autorizados`
3. Clique em **Insert row** e preencha:
   - `email`: e-mail do usuário (ex: `coordenador@facene.com.br`)
   - `nome`: nome completo
   - `instituicao`: slug da instituição (`facene`, `unicet`, `unisc`, `univassouras`, `unifeso` ou `famene`)
   - `ativo`: `true`

---

## Passo 5 — Fazer o deploy no Netlify

1. Substitua os arquivos do seu deploy atual pelos arquivos desta pasta
2. **Atenção:** inclua os novos arquivos na raiz:
   - `supabase-config.js`
   - `recuperar-senha.html`
   - `nova-senha.html`
3. Faça o deploy normalmente no Netlify

---

## Como funciona o fluxo para o usuário final

### Fluxo Admin (`/admin.html`)
1. Admin acessa `/admin.html`
2. Informa e-mail e senha
3. O Supabase valida e verifica se o `role` é `admin` ou `superadmin`
4. Se autorizado → painel liberado
5. Se não → mensagem de erro

### Fluxo Coordenador/Usuário (`/facene`, `/unisc`, etc.)
1. Usuário acessa diretamente `/facene/index.html` (ou qualquer página da instituição)
2. Aparece o modal com abas **"Entrar"** e **"Cadastrar"**
3. **Se já tem conta:** informa e-mail e senha → sistema verifica na whitelist → painel liberado
4. **Se não tem conta:** clica em "Cadastrar" → informa nome, e-mail e senha → sistema cria a conta e verifica na whitelist
   - Se o e-mail **estiver** na whitelist → painel liberado imediatamente
   - Se o e-mail **não estiver** → mensagem pedindo para aguardar autorização do coordenador MedCof

### Recuperação de senha
1. Na tela de login do admin, clicar em "Esqueci minha senha"
2. Informar o e-mail → recebe link por e-mail
3. Clicar no link → redirecionado para `/nova-senha.html`
4. Informar nova senha → redirecionado para o login

---

## Slugs das instituições

| Instituição | Slug |
|---|---|
| FACENE | `facene` |
| UNICET | `unicet` |
| UNISC | `unisc` |
| UNIVASSOURAS | `univassouras` |
| UNIFESO | `unifeso` |
| FAMENE | `famene` |
