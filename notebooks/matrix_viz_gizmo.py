"""
Example usage for creating a volume gizmo.
"""

print(__doc__)

try:
    import imageio
except ImportError:
    print("Please install imageio:")
    raise

import numpy as np


f = open("mri.npy", "rb")
Matrix = np.load(f)

from feedWebGL2 import volume_gizmo
import H5Gizmos as gz

SV = volume_gizmo.SnapshotVolumeComponent(width=1000)

async def task():
    await SV.link()
    await SV.load_3d_numpy_array(Matrix)

gz.serve(task())
