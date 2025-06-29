module.exports = `
# Add files and patterns here that should be excluded from code embeddings for code search (in addition to .gitignore).
**/node_modules/**
**/package-lock.json

# Ignore IDE related files
**/.vscode/**
**/.idea/**

# Ignore build and dist directories
**/build/**
**/dist/**

# Ignore virtual environment directories
**/env/**

# Ignore other common directories
**/__pycache__/**
**/target/**
**/bin/**
**/obj/**
**/packages/**

# Ignore specific files
**/*.sqlite3
**/*.sqlite3-journal
**/*.log
**/*.o
**/*.d
**/*.xcuserstate

# Ignore specific directories
**/DerivedData/**
**/pkg/**
**/images/**
**/assets/**
**/fonts/**
**/sounds/**
**/docs/**
**/test/**
**/tests/**
**/logs/**
**/database/**
**/vendor/**

# Ignore all hidden files
**/.*/**

# Ignore Python specific
**/*.cfg
**/*.h
**/*.pyc
**/*.egg-info/**
**/*.egg
**/*.whl
**/*.pyo
**/*.pyd
**/*.pyw
**/*.pyz
**/*.pyzw
**/*.toc
**/*.spec
**/*.manifest
**/*.ipynb
**/*.ipynb_checkpoints/**
**/site-packages/**

# Ignore Java specific
**/*.class
**/*.jar
**/*.war
**/*.ear

# Ignore C/C++ specific
**/*.a
**/*.out

# Ignore Swift/Objective-C specific
**/*.app
**/*.ipa
**/*.dSYM/**

# Ignore Ruby specific
**/*.gem
**/*.rbc

# Ignore PHP specific
**/*.phar

# Ignore temporary files
**/*~
**/*.tmp
**/*.swp
**/*.swo

# Ignore log files
**/*.log

# Ignore macOS specific
**/.DS_Store

# Ignore empty files
**/.keep

# Ignore Windows specific
**/Thumbs.db
**/Desktop.ini

# Ignore data files
**/*.csv

# Ignore Office files
**/*.doc
**/*.docx
**/*.xls
**/*.xlsx
**/*.ppt
**/*.pptx

# Ignore image files
**/*.jpg
**/*.jpeg
**/*.png
**/*.gif
**/*.bmp
**/*.svg
**/*.ico

# Ignore audio and video files
**/*.mp3
**/*.wav
**/*.mp4
**/*.avi
**/*.flv

# Ignore archive files
**/*.zip
**/*.tar.gz
**/*.rar

# Ignore text, and other documentation files
**/*.txt
**/*.pdf

# Ignore certificates
**/*.cert
**/*.pem
**/*.crt

# Ignore other common temporary or generated files
**/*.bak
**/*.cache
**/*.pid
**/*.dump

# Ignore machine learning specific
**/*.ckpt
**/*.h5
**/*.pkl

# Ignore various IDE and build tool specific directories and files
**/.gradle/**
**/.mvn/**
**/.settings/**

`;