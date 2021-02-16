"""
View a dense 3d vector field as a volume with streamlines and norm isosurfaces.

Assume that values for point (x, y, z) live in array A at

i = int(x/voxel_side)
j = int(y/voxel_side)
k = int(z/voxel_side)

Value is at interpolation of A[i, j, k].
"""

import numpy as np
from numpy.linalg import norm

from IPython.display import display
from feedWebGL2 import volume
from feedWebGL2.volume import widen_notebook

class VectorFieldViewer:

    def __init__(self, x_component, y_component, z_component, voxel_side=1.0, subsample=5, log_norm=True):
        shape = (XI, YJ, ZK) = x_component.shape
        self.shape = np.array(shape, dtype=np.int)
        assert shape == y_component.shape and shape == z_component.shape, (
            "Components should have same shape: " + repr((x_component.shape, y_component.shape, z_component.shape))
        )
        self.nvoxel = XI * YJ * ZK
        [self.x_component, self.y_component, self.z_component, self.voxel_side, self.subsample, self.log_norm] = [
            x_component, y_component, z_component, voxel_side, subsample, log_norm
        ]
        assert subsample > 0 and type(subsample) is int
        field = np.zeros([XI, YJ, ZK, 3], dtype=np.float)
        field[:,:,:,2] = x_component
        field[:,:,:,1] = y_component
        field[:,:,:,0] = z_component
        self.vector_field = field

    def get_norm_matrix(self):
        "get sub-sampled norms of vector field"
        (XI, YJ, ZK) = self.shape
        ss = self.subsample
        (dI, rI) = divmod(XI, ss)
        (dJ, rJ) = divmod(YJ, ss)
        (dK, rK) = divmod(ZK, ss)
        sub_sample_vectors = self.vector_field[0:dI*ss:ss, 0:dJ*ss:ss, 0:dK*ss:ss]
        assert sub_sample_vectors.shape == (dI, dJ, dK, 3)
        norms = norm(sub_sample_vectors, axis=3)
        # convert to log scale if requested
        if self.log_norm:
            norms = np.log(norms + 1.0)
        self.norm_matrix = norms
        self.norm_side = ss * self.voxel_side
        return norms

    def vector_at_zyx(self, zyx_point):
        "Return vector at xyz point of field or None if out of range."
        # KISS for now -- just find the nearest vector after rescaling
        ijk = (zyx_point / self.voxel_side).astype(np.int)
        if not (ijk >= 0).all():
            return None  # out of range, index too small
        if not (ijk < self.shape).all():
            return None  # out of range, index too big
        # otherwise, just use the vector at that index
        [i, j, k] = ijk
        dzdydx = self.vector_field[i, j,k]
        return dzdydx

    def streamLine(self, zyx_start_point, max_number_of_points=None, step_size=None, epsilon=1e-10):
        "compute a stream line using simple interpolation."
        # xxxx no interpolation or runge-kutta correction yet
        if step_size is None:
            step_size = 2 * self.subsample
        if max_number_of_points is None:
            max_number_of_points = int(2 * self.shape.max() / step_size)
        current_point = zyx_start_point
        points = []
        for i in range(max_number_of_points):
            points.append(current_point)
            gradient = self.vector_at_zyx(current_point)
            if gradient is None:
                break # current point is out of range -- stop
            ng = norm(gradient)
            if (ng < epsilon):
                break # no movement at current point...
            normed_gradient = gradient / ng
            current_point = current_point + step_size * normed_gradient
        stream = np.array(points, dtype=np.float)
        return stream

    def displayWidget(
        self, 
        zyx_start_points, 
        max_number_of_points=None, 
        step_size=None, 
        basis_scale=1.0, 
        sprite_shape_weights=None, 
        sprite_shape_normals=None,
        epsilon=1e-10):
        # if start points is an int then choose random in range start points
        if type(zyx_start_points) is int:
            sp = np.random.random((zyx_start_points, 3))
            for i in range(3):   # xxx could use broadcasting...
                sp[:,i] = sp[:, i] * self.shape[i]
            zyx_start_points = sp
        widget = volume.Volume32()
        display(widget.debugging_display())
        # will this work? -- proceed after the widget has initialized
        widget.sync()
        zyx_streamlines = [
            self.streamLine(
                zyx, 
                max_number_of_points=max_number_of_points, 
                step_size=step_size,
                epsilon=epsilon) 
            for zyx in zyx_start_points]
        norm_matrix = self.get_norm_matrix()
        rescaled_streamlines = []
        norm_side = self.norm_side
        for sl in zyx_streamlines:
            rescaled = sl / norm_side
            rescaled_streamlines.append(rescaled.tolist())
        self.rescaled_streamlines = rescaled_streamlines
        widget.load_3d_numpy_array(norm_matrix, threshold=norm_matrix.mean())
        widget.load_stream_lines(
            stream_lines=rescaled_streamlines,
            basis_scale=basis_scale,
            sprite_shape_weights=sprite_shape_weights,
            sprite_shape_normals=sprite_shape_normals,
            )
        widget.build(width=1600)
