@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   魔塔 - 本地静态服务器
echo   关闭本窗口即可停止服务。
echo.

rem Find a python that can really serve files.
rem The Microsoft Store "python" is only a launcher stub - it opens the
rem Store instead of running the script - so probe it with import http.server.
rem NOTE: this file MUST use CRLF line endings. cmd.exe parses LF-only batch
rem files wrong and throws bogus "not recognized as an internal or external
rem command" errors, especially with multi-byte characters.
set "PY="
for %%P in (python py python3) do (
  if not defined PY (%%P -c "import http.server" >nul 2>&1 && set "PY=%%P")
)
if not defined PY goto :nopython

%PY% tools\serve.py
goto :eof

:nopython
echo.
echo   没有找到可用的 Python 3。
echo.
echo   不想装 Python 也行：直接双击 dist\魔塔-单文件版.html 就能玩，
echo   那个版本把所有代码都打包进一个文件，不需要服务器。
echo.
pause
exit /b 1
