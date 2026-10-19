brausa for Windows – please read first
======================================

IMPORTANT: EXPERIMENTAL SOFTWARE

brausa is an early preview and under active development. It was built and tested to the best of our knowledge, but it may still contain bugs. brausa works directly with your files: it moves and renames files, puts them in the Recycle Bin, and writes metadata, maps and wiki files.

Use it at your own risk. To the extent permitted by law, no responsibility or liability is accepted for data loss, damage to files or the system, or any other consequences of use. There is no entitlement to bug fixes, support or further development.

So please:
- make a current backup before using brausa for the first time,
- try brausa with test folders first,
- include important projects only once you have checked brausa yourself.


WHY WINDOWS WARNS
-----------------
brausa is not signed with a code-signing certificate (those cost a yearly fee).
Windows SmartScreen and some browsers therefore warn about the installer. The
warning does not mean that malware was found, only that the publisher is not
verified. Only download brausa from the official page:
https://github.com/lasjoh-toho/brausa/releases


DOWNLOAD
--------
Recommended: brausa_<version>_x64-setup.exe (installs without administrator
rights). The .msi file is meant for managed computers.

If Microsoft Edge says the file "isn't commonly downloaded": in the download
list click "…" > "Keep", then "Show more" > "Keep anyway".


INSTALL AND ALLOW
-----------------
1. Double-click the downloaded file.
2. If "Windows protected your PC" appears:
   click "More info", then "Run anyway".
3. Read and accept the note on experimental software, then follow the installer.

Alternative to step 2: right-click the file > Properties > at the bottom under
"Security" tick "Unblock" > OK. The installer then starts without the
SmartScreen warning.

Smart App Control (Windows 11):
If it is on, Windows blocks unsigned programs without offering "Run anyway". It
can be turned off under Windows Security > App & browser control, but can only
be turned back on by reinstalling Windows. Think this through; if in doubt,
don't use brausa on this computer.


UPDATES
-------
brausa looks for a new version shortly after starting (can be switched off in
the settings, gear icon at the top of the sidebar) and installs it on request.
Updates are signed; brausa only installs updates signed by its publisher.


LANGUAGE
--------
brausa follows the Windows display language (German or English, otherwise
English). Settings (gear icon) > Language changes it.


UNINSTALL
---------
Settings > Apps > Installed apps > brausa > Uninstall. Tags, colours and maps
are kept in the project folders under ".brausa".

More: https://github.com/lasjoh-toho/brausa#readme
