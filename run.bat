@echo off
echo Starting Dynamic QR Manager...
C:\Users\acer\AppData\Local\Python\bin\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
