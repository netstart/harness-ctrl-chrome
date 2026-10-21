# Registro do host de mensagens nativas no Chrome

O Chrome exige que o host de mensagens nativas seja registrado no sistema
antes de a extensao poder se conectar a ele (`chrome.runtime.connectNative`).

## Windows

O registro fica em:

```
HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.harnessctrl.chrome.host
```

O valor default deve apontar para o arquivo JSON do manifesto:

```
C:\src\harness-ctrl-chrome\packages\native-host\com.host.harnessctrl.chrome.windows.json
```

Ajuste o campo `"path"` desse JSON para o caminho do build compilado, ex:

```
"path": "C:\\src\\harness-ctrl-chrome\\packages\\native-host\\dist\\index.js"
```

E substitua `__EXTENSION_ID__` em `"allowed_origins"` pelo ID real da sua
extensao (visível em `chrome://extensions` depois de carregar a extensao
descompactada). Pode ser necessário usar `*` em desenvolvimento.

### Registrar (PowerShell, como administrador ou no HKCU)

```powershell
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.harnessctrl.chrome.host"
if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
Set-ItemProperty -Path $regPath -Name "" -Value "C:\src\harness-ctrl-chrome\packages\native-host\com.host.harnessctrl.chrome.windows.json"
```

## Linux

Copia o manifesto para:

```
/etc/opt/chrome/native-messaging-hosts/com.host.harnessctrl.chrome.json
```

ou para o usuario:

```
~/.config/google-chrome/NativeMessagingHosts/com.host.harnessctrl.chrome.json
```

Ajuste o `"path"` para o build compilado (`dist/index.js`) e o
`__EXTENSION_ID__` pelo ID da extensao carregada.

## macOS

```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.host.harnessctrl.chrome.json
```

## Como carregar a extensao

1. Abra `chrome://extensions`.
2. Ative o "Modo de desenvolvedor" (canto superior direito).
3. Clique em "Carregar sem compactacao" e selecione a pasta
   `packages/chrome-extension/dist` (apos rodar `npm run build` nesse pacote).
4. Anote o ID gerado e preencha no `allowed_origins` do manifesto do host,
   depois registre o host (passos acima) e recarregue a extensao.

## Variaveis de ambiente do host

- `MCP_CHROME_HOST` (default `127.0.0.1`)
- `MCP_CHROME_PORT` (default `8765`)
- `MCP_RECONNECT_INTERVAL_MS` (default `2000`)

O host inicia o servidor MCP (`mcp-server-chrome`) separadamente; ele apenas
faz a ponte TCP. Certifique-se de que o servidor MCP esteja rodando antes de
usar a extensao.
