# Multi-Company Beverage Ordering System - Setup Guide

## 🚀 Complete System Overview

This system extends your original Telegram-based beverage ordering to support multiple companies:

- **Company 1**: "Original Tea Company" (existing Telegram workflow - 100% preserved)
- **Company 2**: "Corporate Beverage Solutions" (new dashboard workflow)

## 📁 File Structure

```
beverage-system/
├── webapp/
│   └── index.html              # Extended multi-company webapp
├── dashboard/
│   └── dashboard.html          # Dashboard application
├── api/
│   ├── server.js              # API server
│   ├── package.json           # Dependencies
│   └── orders.json            # Data storage (auto-created)
└── README.md                  # This setup guide
```

## 🛠️ Step 1: Setup API Server

### Prerequisites
- Node.js 14+ installed
- Basic familiarity with running Node.js applications

### Install API Server

1. **Create API directory and files:**
```bash
mkdir beverage-system
cd beverage-system
mkdir api
cd api
```

2. **Save the provided `server.js` and `package.json` files in the `api` directory**

3. **Install dependencies:**
```bash
npm install
```

4. **Start the API server:**
```bash
npm start
# OR for development with auto-reload:
npm run dev
```

5. **Verify server is running:**
```bash
curl http://localhost:3000/health
```

You should see: `{"status":"healthy","timestamp":"...","uptime":...}`

## 🌐 Step 2: Setup Web Applications

### Deploy Extended Webapp

1. **Create webapp directory:**
```bash
mkdir ../webapp
cd ../webapp
```

2. **Save the extended webapp HTML file as `index.html`**

3. **Test both company configurations:**

**Original Tea Company (Telegram flow):**
```
http://localhost/webapp/index.html?desk=1&company=original-tea
```

**Dashboard Company:**
```
http://localhost/webapp/index.html?desk=1&company=dashboard-company
```

### Deploy Dashboard

1. **Create dashboard directory:**
```bash
mkdir ../dashboard
cd ../dashboard
```

2. **Save the dashboard HTML file as `dashboard.html`**

3. **Access dashboard:**
```
http://localhost/dashboard/dashboard.html
```

## ⚙️ Step 3: Configure Companies

### Adding New Companies

Edit the `companyConfigs` object in the webapp's JavaScript:

```javascript
const companyConfigs = {
  'your-company-id': {
    name: 'Your Company Name',
    theme: 'your-theme', // 'original-tea' or 'dashboard-company' or custom
    logo: null, // URL to logo image or null for default
    webhook: 'your-webhook-url', // For Telegram flow
    orderFlow: 'telegram', // 'telegram' or 'dashboard'
    // ... rest of configuration
  }
};
```

### Company Configuration Options

| Field | Description | Examples |
|-------|-------------|----------|
| `name` | Company display name | "Acme Corp", "Tech Solutions" |
| `theme` | Visual theme | "original-tea", "dashboard-company" |
| `logo` | Logo URL or null | "https://example.com/logo.png" |
| `orderFlow` | Order processing method | "telegram" or "dashboard" |
| `webhook` | Make.com webhook (Telegram only) | Your existing webhook URL |
| `apiEndpoint` | API endpoint (Dashboard only) | "/api/orders" |

## 🔗 Step 4: URL Structure

### QR Code URLs

**Format:** `https://yourserver.com/webapp/index.html?desk=X&company=Y`

**Examples:**
- Original Tea Company: `?desk=1&company=original-tea`
- Dashboard Company: `?desk=5&company=dashboard-company`
- New Company: `?desk=10&company=new-company-id`

### Generate QR Codes

Use any QR code generator with these URLs. Each desk gets a unique QR code.

## 🎯 Step 5: Testing the System

### Test Original Telegram Flow (Company 1)

1. **Access URL:** `?desk=1&company=original-tea`
2. **Verify:** Dark theme, original menu, company name displays
3. **Place order:** Should trigger Make.com webhook → Telegram
4. **Confirm:** Tea boy receives Telegram notification

### Test Dashboard Flow (Company 2)

1. **Ensure API server is running**
2. **Access URL:** `?desk=1&company=dashboard-company`
3. **Verify:** Blue theme, expanded menu, company name displays
4. **Place order:** Should appear in dashboard
5. **Open dashboard:** `dashboard.html` should show the order

### Dashboard Features Testing

- **Real-time updates:** Orders appear automatically
- **Status management:** Change pending → in-progress → completed
- **Filtering:** Filter by status and desk number
- **Statistics:** View order counts and metrics
- **Bulk operations:** Clear all orders

## 🔄 Step 6: Production Deployment

### Web Server Setup

1. **Upload files to your web server:**
```
public_html/
├── webapp/
│   └── index.html
└── dashboard/
    └── dashboard.html
```

2. **For Node.js hosting (API server):**
   - Deploy `server.js` and `package.json`
   - Run `npm install` and `npm start`
   - Configure process manager (PM2, systemd, etc.)

### Environment Configuration

**API Server Environment Variables:**
```bash
export PORT=3000
export NODE_ENV=production
```

**Update API endpoint in dashboard:**
```javascript
// In dashboard.html, update the API endpoint
this.apiEndpoint = 'https://your-api-server.com/api/orders';
```

## 📊 Step 7: Data Management

### Data Storage

- **Development:** JSON file (`orders.json`)
- **Production:** Consider migrating to database (MongoDB, PostgreSQL)

### Backup Strategy

**Automated backup script:**
```bash
#!/bin/bash
cp api/orders.json backups/orders-$(date +%Y%m%d-%H%M%S).json
```

### Data Migration

To migrate to database, modify the `readOrders()` and `writeOrders()` functions in `server.js`.

## 🔧 Step 8: Customization Guide

### Adding New Menu Items

Edit the `menu` object in company configuration:

```javascript
menu: {
  newCategory: {
    name: 'New Category',
    desc: 'Category description',
    items: [
      { id: 'item1', name: 'Item Name', value: 'Item Value' }
    ]
  }
}
```

### Theme Customization

1. **Add new theme class in CSS:**
```css
body.your-theme {
  background: linear-gradient(135deg, #your-colors);
}
```

2. **Update company config:**
```javascript
theme: 'your-theme'
```

### Logo Integration

1. **Add logo URL to company config:**
```javascript
logo: 'https://your-server.com/logos/company-logo.png'
```

2. **Logo displays automatically in the webapp**

## 🚨 Troubleshooting

### Common Issues

**API Server Won't Start:**
- Check Node.js version: `node --version` (requires 14+)
- Verify port 3000 is available: `lsof -i :3000`
- Check error logs in terminal

**Orders Not Appearing in Dashboard:**
- Verify API server is running: `curl http://localhost:3000/health`
- Check browser console for CORS errors
- Ensure orders.json file has correct permissions

**Telegram Integration Not Working:**
- Verify webhook URL in original company config
- Test webhook directly with curl
- Check Make.com scenario status

**QR Codes Not Working:**
- Verify URL format: `?desk=X&company=Y`
- Check web server serves HTML files correctly
- Test URLs directly in browser

### Debug Mode

**Enable detailed logging in API server:**
```javascript
// Add to server.js
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, req.body);
  next();
});
```

**Browser debugging:**
- Open DevTools (F12)
- Check Console tab for errors
- Check Network tab for failed requests

## 📞 Support and Maintenance

### Regular Maintenance Tasks

1. **Monitor API server logs**
2. **Backup orders.json daily**
3. **Check disk space for log files**
4. **Update dependencies monthly**
5. **Test both company flows weekly**

### Performance Optimization

**For high volume:**
- Implement database instead of JSON file
- Add API rate limiting
- Use CDN for static files
- Implement order archiving

### Security Considerations

- **API server:** Add authentication for production
- **Data:** Encrypt sensitive information
- **Access:** Implement role-based access control
- **Logs:** Don't log sensitive data

---

## 🎉 Success!

You now have a fully functional multi-company beverage ordering system that:

✅ **Preserves original Telegram functionality 100%**  
✅ **Supports unlimited companies via URL parameters**  
✅ **Provides real-time dashboard for dashboard companies**  
✅ **Scales easily with new companies and features**  
✅ **Maintains the same high-quality UI/UX**

The system is production-ready and can handle both your existing tea boy workflow and new corporate dashboard requirements seamlessly!