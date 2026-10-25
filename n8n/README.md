# Workflow n8n: ribilanciare le faccende

`ribilancia.json` riceve da Casa l'evento "giorni in sede cambiati", chiede all'LLM di `asr.sf-paris.dev` al massimo 5 proposte e le rimanda a Casa, che le controlla una per una prima di applicarle.

Credenziali da creare in n8n (tipo "Header Auth"):

| Nome | Intestazione | Valore |
|---|---|---|
| `Casa token` | `x-casa-token` | lo stesso valore di `CASA_N8N_TOKEN` nel `.env` di Casa |
| `ASR` | `Authorization` | `Bearer asr_...`, una chiave con scope `llm` |

In Casa, `CASA_N8N_WEBHOOK_URL` punta al webhook di produzione del workflow, per esempio `http://<nome di n8n sulla rete del proxy>:5678/webhook/casa-ribilancia`.
