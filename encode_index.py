import base64
import os

base_dir = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(base_dir, 'index.html')

with open(file_path, 'rb') as f:
    content = f.read()
    b64_content = base64.b64encode(content).decode('ascii')

clean_path = os.path.join(base_dir, 'clean.b64')
with open(clean_path, 'w') as f:
    f.write(b64_content)
