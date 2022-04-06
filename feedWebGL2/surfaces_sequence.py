
"""
A sequence of collections of surface geometries with associated names and colors.

For displaying related isosurfaces.
"""

import H5Gizmos as gz
import numpy as np
from . import local_files

def multiple_list(array, multiplier):
    "return flattened list of integers for semi-optimized json transfer"
    m = array.ravel() * multiplier
    i = m.astype(np.int)
    return i.tolist()

    
required_javascript_modules = [
    local_files.vendor_path("js_lib/three.min.js"),
    local_files.vendor_path("js_lib/OrbitControls.js"),
    local_files.vendor_path("js/surfaces_sequence.js"),
]

class SurfacesGizmo(gz.jQueryComponent):

    """
    Gizmo 3d display for sequence of surfaces
    """

    def __init__(self, width=800):
        super().__init__()
        self.display3d = None
        self.width = width

    def add_dependencies(self, gizmo):
        super().add_dependencies(gizmo)
        for js_file in required_javascript_modules:
            gizmo._js_file(js_file)

    def dom_element_reference(self, gizmo):
        result = super().dom_element_reference(gizmo)
        gz.do(self.element.html("Volume widget not yet loaded."))
        gz.do(self.element.css({"background-color": "cyan"}))
        gz.do(self.element.width(self.width))
        gz.do(self.element.height(self.width))
        return result

    def load_json_object(self, json_object):
        constructor = self.element.surfaces_sequence(json_object)
        self.display3d = self.cache("surfaces3d", constructor)

    def load_3d_display(self):
        gz.do(self.display3d.load_3d_display(self.element))

class SurfaceInfo:

    "A named and colored indexed surface."

    def __init__(self, name, color, indices, positions, normals, check=True):
        self.name = name
        self.color = np.array(color, dtype=np.float32)
        self.indices = np.array(indices, dtype=np.int32)
        self.normals = np.array(normals, dtype=np.float32)
        self.positions = np.array(positions, dtype=np.float32)
        if check:
            self.sanity_check()
        self.max_position = self.positions.max(axis=0)
        self.min_position = self.positions.min(axis=0)

    def json_repr(self, multiplier=999):
        "semi-optimized json repr for transfer to javascript."
        return dict(
            name=self.name,
            multiplier=multiplier,
            color=multiple_list(self.color, multiplier),
            indices=self.indices.ravel().tolist(),
            normals=multiple_list(self.normals, multiplier),
            positions=multiple_list(self.positions, multiplier),
            max_position=multiple_list(self.max_position, multiplier),
            min_positions=multiple_list(self.min_position, multiplier),
        )

    def sanity_check(self):
        sc = self.color.shape
        assert sc == (3,), "bad color: " + repr(self.color)
        (Nn, Dn) = Sn = self.normals.shape
        assert Dn == 3, "bad normals dimension: " + repr(Sn)
        (Np, Dp) = Sp = self.positions.shape
        assert Dp == 3, "bad position dimension: " + repr(Dp)
        assert Nn == Np, "positions and normals don't match: " + repr((Sp, Sn))
        i = self.indices
        (Ni, Di) = Si = i.shape
        im = i.min()
        iM = i.max()
        assert Di == 3, "triangles should have exactly 3 indexed vertices: " + repr(Si)
        assert Ni < 20 * Np, "too many indexed triangles: " + repr(Si)
        assert im >= 0, "negative indices: " + repr(im)
        assert iM < Np, "too large indices: " + repr((Si, Np))

    async def load(self, to_surface_component, targetcollection):
        c = to_surface_component
        indices_ref = await c.store_array(self.indices, "indices")
        normals_ref = await c.store_array(self.normals, "normals")
        positions_ref = await c.store_array(self.positions, "positions")
        t = targetcollection
        gz.do(t.load_surface(self.name, self.color, indices_ref, normals_ref, positions_ref))

def defined_extrema(old_value, new_value, minmax=np.maximum):
    if old_value is None:
        return new_value
    else:
        return minmax(old_value, new_value)

async def labelled_surfaces(label_array, name_to_label, name_to_color, blur=0.7):
    # deprecated/testing
    result = NamedSurfaces()
    from feedWebGL2 import volume_gizmo
    V = volume_gizmo.VolumeComponent()
    await V.show()
    await V.load_3d_numpy_array(label_array)
    labels = set(np.unique(label_array))
    for name in name_to_label:
        label = name_to_label[name]
        if label in labels:
            color = name_to_color[name]
            print(name, "color", color)
            (positions, normals, mask) = await V.get_geometry_for_range(label_array, label, label, blur=blur)
            print("positions", positions.shape)
            (indices, ipos, inorm) = binned_indexing(positions, normals)
            print("indices", indices.shape)
            S = SurfaceInfo(name, color, indices, ipos, inorm)
            result.add(S)
    return result

class SurfaceMaker:

    """
    Collect surface sequence for label arrays.
    all label arrays must have the same shape.
    """

    def __init__(self, blur=0.7):
        self.V = None
        self.sequence = SurfacesSequence()
        self.blur = blur

    async def set_up_gizmo(self, example_array):
        from feedWebGL2 import volume_gizmo
        V = volume_gizmo.VolumeComponent()
        await V.show()
        await V.load_3d_numpy_array(example_array)
        self.V = V

    async def add_surfaces(self, label_array, name_to_label, name_to_color):
        blur = self.blur
        if self.V is None:
            await self.set_up_gizmo(label_array)
        assert self.V is not None
        V = self.V
        result = NamedSurfaces()
        labels = set(np.unique(label_array))
        for name in name_to_label:
            label = name_to_label[name]
            if label in labels:
                color = name_to_color[name]
                print(name, "color", color)
                (positions, normals, mask) = await V.get_geometry_for_range(label_array, label, label, blur=blur)
                print("positions", positions.shape)
                (indices, ipos, inorm) = binned_indexing(positions, normals)
                print("indices", indices.shape, ipos.shape)
                S = SurfaceInfo(name, color, indices, ipos, inorm)
                result.add(S)
        print ("adding sequence", len(self.sequence.sequence))
        self.sequence.add(result)
        return result
    

async def labelled_surfaces(label_array, name_to_label, name_to_color, blur=0.7):
    # deprecated/testing replaced by SurfaceMaker
    result = NamedSurfaces()
    from feedWebGL2 import volume_gizmo
    V = volume_gizmo.VolumeComponent()
    await V.show()
    await V.load_3d_numpy_array(label_array)
    labels = set(np.unique(label_array))
    for name in name_to_label:
        label = name_to_label[name]
        if label in labels:
            color = name_to_color[name]
            print(name, "color", color)
            (positions, normals, mask) = await V.get_geometry_for_range(label_array, label, label, blur=blur)
            print("positions", positions.shape)
            (indices, ipos, inorm) = binned_indexing(positions, normals)
            print("indices", indices.shape)
            S = SurfaceInfo(name, color, indices, ipos, inorm)
            result.add(S)
    return result


class NamedSurfaces:

    """
    A collection of SurfacesInfo elements.
    """

    def __init__(self):
        self.surfaces = {}
        self.max_position = self.min_position = None

    def json_repr(self, multiplier=999):
        "semi-optimized json repr for transfer to javascript."
        s_json = { str(name): s.json_repr(multiplier) for (name, s) in self.surfaces.items() }
        return dict(
            surfaces=s_json,
            multiplier=multiplier,
            max_position=multiple_list(self.max_position, multiplier),
            min_positions=multiple_list(self.min_position, multiplier),
        )

    def add(self, surface):
        self.surfaces[surface.name] = surface
        self.max_position = defined_extrema(self.max_position, surface.max_position, np.maximum)
        self.min_position = defined_extrema(self.min_position, surface.min_position, np.minimum)

    def doodle(self):
        # only for debugging/dev
        MM = self.max_position
        mm = self.min_position
        diameter = np.linalg.norm(MM - mm)
        center = (MM + mm) / 2
        from jp_doodle import nd_frame
        swatch = nd_frame.swatch3d(pixels=800, model_height=diameter)
        self.doodle_draw(swatch)
        swatch.orbit_all(center3d=center, radius=diameter)
        swatch.fit(0.6)

    def doodle_draw(self, swatch):
        for surface in self.surfaces.values():
            ii = surface.indices
            pp = surface.positions
            #nn = surface.normals
            rgb = tuple(map(int, surface.color * 255))
            color = "rgb" + repr(rgb)
            print ("surface", surface.name, "color", color)
            for [i1, i2, i3] in ii:
                triangle = [pp[i1], pp[i2], pp[i3], ]
                swatch.polygon(triangle, fill=False, color=color)
                #t0 = triangle[0]
                #v = t0 + nn[i1]
                #swatch.line(t0, v, color="red")

class SurfacesSequence:

    """
    A sequence of NamedSurfaces collections.
    """

    def __init__(self):
        self.sequence = []
        self.max_position = self.min_position = None
        self.current_index = 0

    def json_repr(self, multiplier=999):
        "semi-optimized json repr for transfer to javascript."
        s_json = [ s.json_repr(multiplier) for s in self.sequence ]
        MM = self.max_position
        mm = self.min_position
        self.diameter = diameter = np.linalg.norm(MM - mm)
        self.center = center = (MM + mm) * 0.5
        return dict(
            diameter=float(diameter),
            center=multiple_list(center, multiplier),
            sequence=s_json,
            multiplier=multiplier,
            max_position=multiple_list(self.max_position, multiplier),
            min_position=multiple_list(self.min_position, multiplier),
        )

    def add(self, surfaces):
        self.sequence.append(surfaces)
        self.max_position = defined_extrema(self.max_position, surfaces.max_position, np.maximum)
        self.min_position = defined_extrema(self.min_position, surfaces.min_position, np.minimum)

    def doodle(self):
        # xxxx cut/paste...
        MM = self.max_position
        mm = self.min_position
        self.diameter = diameter = np.linalg.norm(MM - mm)
        self.center = center = (MM + mm) / 2
        from jp_doodle import nd_frame
        swatch = nd_frame.swatch3d(pixels=800, model_height=diameter)
        self.doodle_draw(swatch)
        swatch.orbit_all(center3d=center, radius=diameter)
        swatch.fit(0.6)

    def doodle_draw(self, swatch):
        swatch.reset()
        surface = self.sequence[self.current_index]
        surface.doodle_draw(swatch)


def binned_indexing(triangle_positions, triangle_normals, binsize=10000, epsilon=1e-12):
    """
    Create indexing for positions that are nearby from unindexed triangles
    """
    # xxxx don't compute normal correction for now
    tn = np.array(triangle_normals, dtype=np.float32)
    tp = np.array(triangle_positions, dtype=np.float32)
    tns = tn.shape
    tps = tp.shape
    assert tns == tps, "bad shapes for triangle inputs: " + repr((tns, tps))
    (ntriangles, t1, t2) = tns
    assert t1 == 3 and t2 == 3, "triangles should have 3 vert, 3 dims: " + repr(tns)
    all_size = ntriangles * 3
    all_positions = tp.reshape((all_size, 3))
    all_normals = tn.reshape((all_size, 3))
    M = all_positions.max(axis=0)
    m = all_positions.min(axis=0)
    D = M - m
    if D.min() < epsilon:
        D[:] += epsilon
    def bin_key(position):
        n = binsize * (position - m) / D
        B = n.astype(np.int)
        return tuple(map(int, B))
    p_bins = {}
    n_bins = {}
    for (index, position) in enumerate(all_positions):
        key = bin_key(position)
        p_bins[key] = position
        n_bins[key] = all_normals[index]
    keys = sorted(p_bins.keys())
    k2i = {k: i for (i, k) in enumerate(keys)}
    positions = np.array([p_bins[k] for k in keys], dtype=np.float32)
    normals = np.array([n_bins[k] for k in keys], dtype=np.float32)
    indices = np.array(
        [
            [k2i[bin_key(p1)], k2i[bin_key(p2)], k2i[bin_key(p3)] ]
            for [p1, p2, p3] in triangle_positions
        ], 
        dtype = np.int32
    )
    return (indices, positions, normals)

def test_gizmo(fn="simple.json"):
    import json
    f = open(fn)
    ob = json.load(f)
    G = SurfacesGizmo()
    async def task():
        await S.show()
        G.load_json_object(ob)
        #G.add(B)
    def start(*ignored):
        G.load_3d_display()
    B = gz.Button("Start", on_click=start)
    S = gz.Stack([B, G])
    gz.serve(task())