import json

with open('more_climate_eda.ipynb', 'r') as f:
    nb = json.load(f)

# Fix the markdown cell (should be cell 35, index 34)
if len(nb['cells']) > 34:
    cell = nb['cells'][34]
    if cell.get('cell_type') == 'markdown':
        if isinstance(cell['source'], list):
            # Join all strings and split by newlines, preserving structure
            text = ''.join(cell['source'])
            lines = text.split('\n')
            # Format with proper newlines
            cell['source'] = [line + '\n' if line else '\n' for line in lines]

with open('more_climate_eda.ipynb', 'w') as f:
    json.dump(nb, f, indent=1)

print("Fixed the markdown cell")
