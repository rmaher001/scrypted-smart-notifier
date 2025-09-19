# Deployment Guide for Scrypted Smart Notifier

## CRITICAL: Always Deploy From Correct Directory

### Smart Notifier (TypeScript)
```bash
cd /Users/richard/node/scrypted/plugins/smart-notifier
npm run build
npm run deploy
```
- Has `deploy` script in package.json with IP hardcoded (192.168.86.74)
- Uses `npx scrypted-deploy-debug` under the hood

### ReID Service (Python)
```bash
cd /Users/richard/node/scrypted/plugins/reid-service
npm run scrypted-deploy 192.168.86.74
```
- No `deploy` script in package.json
- Must use `scrypted-deploy` with IP as argument
- Python plugins don't need build step

## Important Notes

1. **ALWAYS deploy from `/Users/richard/node/scrypted/plugins/` directories**
   - NOT from `/Users/richard/scrypted-smart-notifier/` (that's just the GitHub repo)

2. **File Sync Before Deploy**
   - If editing in GitHub repo, copy to plugins directory first:
   ```bash
   cp /Users/richard/scrypted-smart-notifier/smart-notifier/src/main.ts /Users/richard/node/scrypted/plugins/smart-notifier/src/main.ts
   cp /Users/richard/scrypted-smart-notifier/reid-service/src/main.py /Users/richard/node/scrypted/plugins/reid-service/src/main.py
   ```

3. **Server IP**: 192.168.86.74 (port 10443 for debug deployment)

4. **Python Plugin Quirks**:
   - May take significant time to initialize (downloading models, installing deps)
   - Server restart sometimes needed after dependency changes
   - Logs may be delayed during initialization

## Quick Deploy Both
```bash
# Smart Notifier
cd /Users/richard/node/scrypted/plugins/smart-notifier && npm run build && npm run deploy

# ReID Service
cd /Users/richard/node/scrypted/plugins/reid-service && npm run scrypted-deploy 192.168.86.74
```