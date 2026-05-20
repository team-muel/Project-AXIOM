import sys, os, time

os.environ['NOTAGEN_REPO_PATH'] = r'C:\NotaGen'
os.environ['NOTAGEN_TIMEOUT_MS'] = '300000'
os.environ['NOTAGEN_MAX_TOKENS'] = '20000'

axiom_workers = r'C:\Users\seoje\OneDrive\문서\New project\Project-AXIOM\workers\composer\learned_symbolic'
sys.path.insert(0, axiom_workers)
sys.path.insert(0, r'C:\NotaGen\gradio')

import torch
print(f"torch {torch.__version__}, CUDA={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    vram_total = torch.cuda.get_device_properties(0).total_memory / 1024**3
    print(f"VRAM: {vram_total:.1f} GB")

from notagen_engines import notagen_native

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"\nLoading model on {device}...")
t0 = time.time()
weight_path = r'C:\NotaGen\weights\weights_notagen_pretrain_p_size_16_p_length_2048_p_layers_12_c_layers_3_h_size_768_lr_0.0002_batch_8.pth'
model, patchilizer = notagen_native.load_model(weight_path, '', device)
print(f"Model loaded in {time.time()-t0:.1f}s on {model.device}, dtype={next(model.parameters()).dtype}")

if torch.cuda.is_available():
    vram_used = torch.cuda.memory_allocated() / 1024**2
    print(f"VRAM used after load: {vram_used:.0f} MB")

test_header = """%% axiom_form=nocturne
%% axiom_key=F major
%% axiom_instrumentation=piano
%% axiom_period=Romantic
%% axiom_composer=Chopin, Frederic
"""

print(f"\nGenerating (device={device}, max_tokens=20000)...")
print("Timing first 10 patches individually...")

# Monkey-patch to time individual patches
original_loop = notagen_native._run_generation_loop
patch_times = []
patch_count = [0]

import contextlib

def timed_loop(model, patchilizer, prompt_lines, **kwargs):
    import torch as _torch
    device = model.device
    try:
        from config import PATCH_SIZE as patch_size_val, PATCH_LENGTH as patch_length_val
    except ImportError:
        patch_size_val, patch_length_val = 16, 1024

    bos_patch = [patchilizer.bos_token_id] * (patch_size_val - 1) + [patchilizer.eos_token_id]
    prompt_patches = patchilizer.patchilize_metadata(prompt_lines)
    prompt_patches = [
        [ord(c) for c in p] + [patchilizer.special_token_id] * (patch_size_val - len(p))
        for p in prompt_patches
    ]
    prompt_patches.insert(0, bos_patch)
    input_patches = _torch.tensor(prompt_patches, device=device).reshape(1, -1)

    byte_list = list("".join(prompt_lines))
    total_start = time.time()
    
    with _torch.inference_mode():
        for i in range(30):  # just time 30 patches for speed estimate
            t_patch = time.time()
            if device.type == "cuda":
                ctx = _torch.autocast(device_type="cuda", dtype=_torch.float16)
            else:
                ctx = contextlib.nullcontext()
            with ctx:
                predicted_patch = model.generate(
                    input_patches.unsqueeze(0),
                    top_k=kwargs.get('top_k', 9),
                    top_p=kwargs.get('top_p', 0.9),
                    temperature=kwargs.get('temperature', 1.0),
                )
            elapsed = time.time() - t_patch
            decoded = patchilizer.decode([predicted_patch])
            byte_list.extend(list(decoded))
            print(f"  Patch {i:2d}: {elapsed:.2f}s | {decoded[:40]!r}")
            
            # Check EOS
            if predicted_patch[0] == patchilizer.bos_token_id and predicted_patch[1] == patchilizer.eos_token_id:
                print("  EOS reached early!")
                break
            
            predicted_tensor = _torch.tensor([predicted_patch], device=device)
            input_patches = _torch.cat([input_patches, predicted_tensor], dim=1)
            patch_times.append(elapsed)

    avg_time = sum(patch_times) / len(patch_times) if patch_times else 0
    print(f"\nAverage time per patch: {avg_time:.2f}s")
    print(f"Estimated full piece time (~600 patches): {avg_time * 600 / 60:.1f} minutes")
    print(f"Generated {len(byte_list)} chars so far")
    return "", True  # return empty but success=True for test purposes

try:
    timed_loop(model, patchilizer, ["%Romantic\n", "%Chopin, Frederic\n", "%Piano\n"],
               top_k=9, top_p=0.9, temperature=1.0)
except Exception as e:
    print(f"Error: {e}")
    import traceback; traceback.print_exc()
