brausa for macOS – please read first
====================================

IMPORTANT: EXPERIMENTAL SOFTWARE

brausa is an early preview and under active development. It was built and tested to the best of our knowledge, but it may still contain bugs. brausa works directly with your files: it moves and renames files, puts them in the Trash, and writes metadata, maps and wiki files.

Use it at your own risk. To the extent permitted by law, no responsibility or liability is accepted for data loss, damage to files or the system, or any other consequences of use. There is no entitlement to bug fixes, support or further development.

So please:
- make a current backup before using brausa for the first time,
- try brausa with test folders first,
- include important projects only once you have checked brausa yourself.


INSTALL
-------
1. Drag brausa.app into the "Applications" folder.
2. Eject the "brausa" disk in the Finder.


FIRST START: ALLOW BRAUSA
-------------------------
brausa is not signed and notarized by Apple (that needs a paid developer
account), so macOS blocks the first start. The message does not mean that
malware was found, only that Apple does not know the publisher. Only download
brausa from the official page:
https://github.com/lasjoh-toho/brausa/releases

macOS 15 (Sequoia) and later:
1. Double-click brausa in the Applications folder.
   "'brausa' cannot be opened …" appears. Click "Done"
   (not "Move to Trash").
2. Open System Settings > Privacy & Security and scroll down to "Security".
3. Next to "'brausa' was blocked …" click "Open Anyway", confirm with your
   password or Touch ID, and choose "Open Anyway" again in the next window.

macOS 14 (Sonoma) and earlier:
1. In the Applications folder, Control-click brausa (or right-click) and
   choose "Open".
2. Click "Open" again in the dialog.

After that, brausa starts normally with a double-click.

If macOS says brausa is "damaged":
That is the same block in a stricter form. Enter in Terminal:

    xattr -dr com.apple.quarantine /Applications/brausa.app

and then open brausa as above.


UPDATES
-------
brausa looks for a new version shortly after starting (can be switched off in
the settings, gear icon at the top of the sidebar) and installs it on request.
Updates are signed; brausa only installs updates signed by its publisher.


LANGUAGE
--------
brausa follows the language of your Mac (German or English, otherwise
English). Settings (gear icon) > Language changes it.


ACCESS TO FOLDERS
-----------------
When you first open Desktop, Documents, Downloads or external drives, macOS asks
whether brausa may access them. Confirm with "Allow". You can change this under
System Settings > Privacy & Security > Files and Folders.


UNINSTALL
---------
Move brausa.app from the Applications folder to the Trash. Tags, colours and
maps are kept in the project folders under ".brausa".

More: https://github.com/lasjoh-toho/brausa#readme
