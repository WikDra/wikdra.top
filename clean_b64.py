import base64
import os

base_dir = os.path.dirname(os.path.abspath(__file__))
temp_path = os.path.join(base_dir, 'temp.b64')
clean_path = os.path.join(base_dir, 'clean.b64')

if os.path.exists(temp_path):
    with open(temp_path, 'r') as f:
        lines = f.readlines()

    # Remove headers/footers and newlines
    b64_content = "".join([line.strip() for line in lines if not line.startswith('---')])

    with open(clean_path, 'w') as f:
        f.write(b64_content)
else:
    print(f"Error: {temp_path} not found.")
