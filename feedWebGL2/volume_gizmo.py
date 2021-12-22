
"""
H5Gizmo for viewing a dense 3d matrix isosurfaces.
"""

from . import volume
import numpy as np
import H5Gizmos as gz
import jp_proxy_widget

# Required javascript modules:
from jp_doodle.bounded_value_slider import bfs_js
from jp_doodle.dual_canvas import required_javascript_modules as doodle_requirements

JS_MODULE_REQUIREMENTS = (
    doodle_requirements +
    [bfs_js] +
    volume.required_javascript_modules # +
    #[volume.local_files.vendor_path("js/volume_gizmo_support.js")]
)

class VolumeComponent(gz.jQueryComponent):

    def __init__(self, width=1200, color="cyan"):
        super().__init__()
        self.V = None
        self.width = width
        self.color = color

    def add_dependencies(self, gizmo):
        super().add_dependencies(gizmo)
        for js_file in JS_MODULE_REQUIREMENTS:
            gizmo._js_file(js_file)
        #gizmo._initial_reference("volume_support", "volume_gizmo_support()")

    def dom_element_reference(self, gizmo):
        result = super().dom_element_reference(gizmo)
        gz.do(self.element.html("Volume widget not yet loaded."))
        gz.do(self.element.css({"background-color": self.color}))
        gz.do(self.element.width(self.width))
        return result

    async def load_3d_numpy_array(
            self, ary, 
            threshold=None, shrink_factor=None,
            #method="cubes",
            sorted=True,
            camera_up=dict(x=0, y=1, z=0),
            camera_offset=dict(x=0, y=0, z=1),
            camera_distance_multiple=2.0,
            di=dict(x=1, y=0, z=0),  # xyz offset between ary[0,0,0] and ary[1,0,0]
            dj=dict(x=0, y=1, z=0),  # xyz offset between ary[0,0,0] and ary[0,1,0]
            dk=dict(x=0, y=0, z=1),  # xyz offset between ary[0,0,0] and ary[0,0,1]
            solid_labels=None,
            axis_length=True,
            ):
        self.dispose(verbose=False)
        if threshold is None:
            threshold = 0.5 * (ary.min() + ary.max());
        gz.do(self.element.css({"background-color": "#ddd"}))
        gz.do(self.element.html("Loading shape: " + repr(ary.shape) + " " + repr([threshold, shrink_factor])))
        self.array = ary
        self.dk = self.positional_xyz(dk)
        self.di = self.positional_xyz(di)
        self.dj = self.positional_xyz(dj)
        if shrink_factor is None:
            shrink_factor = self.shrink_heuristic(*ary.shape)
        (num_layers, num_rows, num_cols) = ary.shape
        ary32 = np.array(ary, dtype=np.float32)
        self.set_options(
            num_rows=num_rows, num_cols=num_cols, num_layers=num_layers, 
            threshold=threshold, shrink_factor=shrink_factor, 
            #method=method,
            sorted=sorted, 
            camera_up=camera_up, 
            camera_offset=camera_offset,
            camera_distance_multiple=camera_distance_multiple,
            dk=self.dk,
            dj=self.dj,
            di=self.di,
            solid_labels=solid_labels,
            axis_length=axis_length,
            )
        self.data = ary32
        # Transfer array to JS
        self.data_ref = await self.store_array(ary32, "volume_data")
        # Store array in volume component buffer
        gz.do(self.V._set("buffer", self.data_ref))
        # Break volume_data reference to possibly save memory.
        self.cache("volume_data", None)
        # Construct the component DOM representation.
        gizmo = self.gizmo
        element = self.element
        gz.do(element.empty())
        self.V_container = self.cache("V_container", gizmo.jQuery("<div/>").appendTo(element))
        gz.do(self.V.build_scaffolding(self.V_container, self.width))

    def create_volume_container(self, options):
        self.V = self.cache("V", self.element.marching_cubes32(options))

    async def get_volume_array(self):
        assert self.V is not None, "No gizmo displayed."
        pixel_info = await gz.get(self.V.get_pixels())
        return self.pixel_info_as_array(pixel_info)

    async def get_voxel_array(self):
        assert self.V is not None, "No gizmo displayed."
        pixel_info = await gz.get(self.V.get_voxel_pixels())
        return self.pixel_info_as_array(pixel_info)

    def pixel_info_as_array(self, pixel_info):
        data_bytes = gz.hex_to_bytearray(pixel_info["data"])
        width = pixel_info["width"]
        height = pixel_info["height"]
        bytes_per_pixel = 4
        array1d = np.array(data_bytes, dtype=np.ubyte)
        image_array = array1d.reshape((height, width, bytes_per_pixel))
        # invert the rows
        image_array = image_array[::-1]
        return image_array

    def set_options(
            self, num_rows, num_cols, num_layers, 
            threshold=0,
            shrink_factor=0.2,
            #method="cubes",
            sorted=True,
            camera_up=None, 
            camera_offset=None,
            camera_distance_multiple=None,
            di=None,
            dj=None,
            dk=None,
            solid_labels=None,
            axis_length=True,
            ):
        # xxxx cut/paste/modified from volume.py.
        #methods = ("tetrahedra", "diagonal", "cubes")
        #assert method in methods, "method must be in " + repr(methods)
        #self.method = method
        options = jp_proxy_widget.clean_dict(
            num_rows=num_rows, num_cols=num_cols, num_layers=num_layers, 
            threshold=threshold, 
            shrink_factor=shrink_factor, 
            #method=method,
            sorted=sorted,
            camera_up=camera_up, 
            camera_offset=camera_offset,
            camera_distance_multiple=camera_distance_multiple,
            di=di, dj=dj, dk=dk,
            solid_labels=solid_labels,
            axis_length=axis_length,
        )
        self.options = options
        self.create_volume_container(options)

    def dispose(self, verbose=True):
        "Attempt to release all resources in self."
        if self.V is not None:
            if verbose:
                print ("Disposing of volume widget.")
            gz.do(self.V.dispose())

    def positional_xyz(self, dictionary):
        # xxx cut/paste
        return [dictionary["x"], dictionary["y"], dictionary["z"], ]

    shrink_multiple = 4.0
    shrink_max = 0.7

    def shrink_heuristic(self, n, m, k):
        # xxx cut/paste
        c = (n*m + m*k + n*k) * self.shrink_multiple / (n*m*k)
        return min(c, self.shrink_max)