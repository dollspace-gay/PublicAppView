# Python Firehose Consumer - Documentation Index

**Quick Navigation** - Choose your path:

## 🚀 I Want to Get Started Now
→ **[QUICKSTART.md](./QUICKSTART.md)** - 5-minute setup guide

## 📖 I Want to Understand This
→ **[SUMMARY.md](./SUMMARY.md)** - High-level overview and rationale  
→ **[README.md](./README.md)** - Detailed documentation

## 🔄 I Want to Migrate from TypeScript
→ **[../PYTHON_FIREHOSE_MIGRATION.md](../PYTHON_FIREHOSE_MIGRATION.md)** - Step-by-step migration guide  
→ **[../ARCHITECTURE_COMPARISON.md](../ARCHITECTURE_COMPARISON.md)** - Before/after comparison

## 💻 I Want to Read the Code
→ **[firehose_consumer.py](./firehose_consumer.py)** - Main consumer (well-documented, ~400 lines)  
→ **[requirements.txt](./requirements.txt)** - Python dependencies  
→ **[Dockerfile](./Dockerfile)** - Container image

---

## What Is This?

A **high-performance Python service** that replaces TypeScript firehose connections to eliminate worker overhead and memory limitations.

### The Problem
- TypeScript needs 32 workers = 64GB RAM
- V8 heap limits, complex coordination
- Database connection pool exhaustion

### The Solution
- Python handles firehose → Redis (1 process, 2GB RAM)
- TypeScript handles processing (4 workers, 8GB RAM)
- **Total: 85% memory reduction, same functionality**

---

## File Guide

| File | Purpose | Read This If... |
|------|---------|-----------------|
| **QUICKSTART.md** | 5-minute getting started | You want to deploy now |
| **SUMMARY.md** | Executive summary | You want the big picture |
| **README.md** | Complete documentation | You want all the details |
| **firehose_consumer.py** | Main Python script | You want to understand the code |
| **Dockerfile** | Container image | You want to customize deployment |
| **requirements.txt** | Python dependencies | You want to know what's installed |
| **INDEX.md** | This file | You want to navigate the docs |

---

## Quick Commands

```bash
# Deploy
docker-compose up -d python-firehose

# Logs
docker-compose logs -f python-firehose

# Status
docker-compose ps python-firehose

# Verify events
docker-compose exec redis redis-cli XLEN firehose:events

# Memory usage
docker stats python-firehose
```

---

## Key Concepts

### 1. Hybrid Architecture
- **Python**: Firehose ingestion only (500 lines)
- **TypeScript**: All business logic (10,000+ lines, unchanged)

### 2. Redis as Bridge
- Python pushes to `firehose:events` stream
- TypeScript workers consume from same stream
- Same format, no changes needed

### 3. Drop-in Replacement
- TypeScript workers don't know Python exists
- Events arrive in Redis same as before
- Zero business logic changes required

---

## Documentation Tree

```
python-firehose/
├── INDEX.md               ← You are here
├── QUICKSTART.md          ← Start here for quick deploy
├── SUMMARY.md             ← Overview and rationale
├── README.md              ← Complete documentation
├── firehose_consumer.py   ← Main code
├── Dockerfile             ← Container config
├── requirements.txt       ← Dependencies
└── .gitignore             ← Git ignore rules

../
├── PYTHON_FIREHOSE_MIGRATION.md   ← Migration guide
└── ARCHITECTURE_COMPARISON.md      ← Before/after comparison
```

---

## Next Steps

1. **New user?** → Read [QUICKSTART.md](./QUICKSTART.md)
2. **Want context?** → Read [SUMMARY.md](./SUMMARY.md)
3. **Migrating?** → Read [../PYTHON_FIREHOSE_MIGRATION.md](../PYTHON_FIREHOSE_MIGRATION.md)
4. **Need details?** → Read [README.md](./README.md)

---

**Remember**: This is just the ingestion layer. Your TypeScript business logic stays unchanged!
