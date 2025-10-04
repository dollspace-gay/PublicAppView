# Instance Moderation Setup Guide

This guide helps you configure legal compliance and content moderation for your AT Protocol App View instance.

## Quick Start

1. **Copy the environment template**
   ```bash
   cp .env.instance-moderation.example .env.local
   ```

2. **Set your jurisdiction**
   ```env
   INSTANCE_JURISDICTION=US  # or EU, UK, DE, etc.
   LEGAL_CONTACT_EMAIL=legal@yourdomain.com
   ```

3. **Configure auto-moderation threshold**
   ```env
   AUTO_HIDE_THRESHOLD=10  # Lower = stricter
   ```

4. **Customize labels** (optional)
   - Edit `server/config/instance-moderation.ts`
   - Enable/disable labels based on your needs
   - See examples in `instance-moderation.example.ts`

## Label Categories

### Legal Labels (HIGH PRIORITY)
Content that MUST be removed for legal compliance:
- `dmca-takedown` - Copyright violations
- `court-order` - Court-mandated removals
- `illegal-content` - Jurisdiction-specific illegal content
- `dsa-removal` - EU Digital Services Act (EU only)
- `netzdg-removal` - German NetzDG law (Germany only)

### Safety Labels (MEDIUM PRIORITY)
Content violating platform safety:
- `doxxing` - Personal information disclosure
- `impersonation` - Fake accounts
- `credible-threat` - Threats of violence
- `self-harm` - Self-harm promotion

### Quality Labels (LOW PRIORITY)
Low-quality content:
- `spam-extreme` - Obvious spam
- `malicious-link` - Phishing/malware links
- `report-threshold` - Exceeds user reports

## Actions

Each label triggers an action:
- **`delete-reference`** - Remove from index entirely
- **`hide`** - Hide from public feeds
- **`blur`** - Show with content warning
- **`flag`** - Mark for manual review

## API Endpoints

### Public (Transparency)
```bash
# View instance moderation policy
GET /api/instance/policy

# View moderation statistics
GET /api/instance/stats
```

### Admin Only (Requires Auth)
```bash
# Apply instance label
POST /api/instance/label
{
  "subject": "at://did:plc:xyz/app.bsky.feed.post/abc",
  "labelValue": "dmca-takedown",
  "reason": "Copyright claim from XYZ Corp"
}

# Handle legal takedown
POST /api/instance/takedown
{
  "subject": "at://did:plc:xyz/app.bsky.feed.post/abc",
  "requestType": "dmca",
  "requestor": "Legal Dept, XYZ Corp",
  "details": "Claim #12345 - unauthorized use of copyrighted material"
}
```

## Jurisdiction Examples

### United States
```env
INSTANCE_JURISDICTION=US
LEGAL_CONTACT_EMAIL=dmca@yourdomain.com
AUTO_HIDE_THRESHOLD=10
```
Focus: DMCA takedowns, court orders

### European Union
```env
INSTANCE_JURISDICTION=EU
LEGAL_CONTACT_EMAIL=dsa-contact@yourdomain.eu
AUTO_HIDE_THRESHOLD=5
```
Enable: `dsa-removal` label
Focus: DSA compliance, GDPR right to erasure

### Germany
```env
INSTANCE_JURISDICTION=DE
LEGAL_CONTACT_EMAIL=netzdg@yourdomain.de
AUTO_HIDE_THRESHOLD=3
```
Enable: `netzdg-removal` label
Note: 24-hour response requirement for NetzDG

### Personal Instance
```env
INSTANCE_JURISDICTION=PRIVATE
LEGAL_CONTACT_EMAIL=admin@personal.instance
AUTO_HIDE_THRESHOLD=999
ENABLE_INSTANCE_MODERATION=false  # Optional: disable entirely
```

## Adding Custom Labels

1. Open `server/config/instance-moderation.ts`
2. Add to appropriate category:

```typescript
{
  value: 'my-custom-label',
  severity: 'warn',
  action: 'blur',
  reason: 'legal',
  description: 'Custom legal requirement for my jurisdiction',
  enabled: true,
}
```

## Important Notes

### What Instance Moderation Handles
✅ Delisting content from YOUR index  
✅ Hiding content from YOUR feeds  
✅ Labeling for YOUR users  
✅ Legal compliance for YOUR jurisdiction  

### What It Doesn't Handle
❌ Deleting content from user PDSs (that's the PDS operator's job)  
❌ Network-wide moderation (that's labeler services)  
❌ Image/video scanning (subscribe to third-party labelers)  

### Best Practices

1. **Minimal is Better** - Only enable labels you legally need
2. **Document Everything** - Keep records of takedown requests
3. **Be Transparent** - Your policy is public at `/api/instance/policy`
4. **Separate Concerns** - Use third-party labelers for content preferences
5. **Respond Quickly** - Some jurisdictions have response time requirements

## Troubleshooting

**Labels not appearing?**
- Check `ENABLE_INSTANCE_MODERATION=true`
- Verify `APPVIEW_DID` is set correctly
- Check label is `enabled: true` in config

**Jurisdiction-specific labels not working?**
- Make sure you enabled them in `instance-moderation.ts`
- Set `enabled: true` for your jurisdiction's labels

**Need help?**
- Check examples in `instance-moderation.example.ts`
- Review AT Protocol labeling spec: https://atproto.com/specs/label
