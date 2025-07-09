@echo off
git add .
git commit -m "Update homepage layout and store hours design"
git push

echo please wait few minutes before website been updated

start https://mail-system-ur12.onrender.com/
pause