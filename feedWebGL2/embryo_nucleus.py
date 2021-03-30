"""
This module impolements an interactive visualization tool
to help with registering embryo nuclii using data derived from
3d microscopy timeslices.  It probably may not be useful for any other purpose
(except, perhaps as example usage code for the volume widgeet).
"""

from feedWebGL2 import volume
import h5py
import numpy as np
import os
from PIL import Image, ImageSequence
import glob
from IPython.display import display
import ipywidgets as widgets

class TimeSlice:

    """
    Visualization for a 3d time slice with classifications.
    """

    di=dict(x=0, y=0, z=4)  # xyz offset between ary[0,0,0] and ary[1,0,0]
    dj=dict(x=0, y=1, z=0)  # xyz offset between ary[0,0,0] and ary[0,1,0]
    dk=dict(x=1, y=0, z=0)  # xyz offset between ary[0,0,0] and ary[0,0,1]
    width = 900  # width of each volume display
    kj_stride = 2

    def __init__(
        self, 
        folder="/Users/awatters/misc/LisaBrown/mouse-embryo/mouse-embryo-nuclei", 
        path_prefix="162954/162954",
        holder=None,
        ):
        print ("ts init", folder, path_prefix)
        self.folder = folder
        self.path_prefix = path_prefix
        self.holder = holder
        self.raster_path_h5 = self.path_must_exist("Orig.h5")
        self.labels_path_tiff = self.path_must_exist("Labels.tiff")
        self.selected_label = None
        self.get_raster_array()
        self.get_labels_array()

    def print_info(self):
        print("TimeSlice:")
        r = self.full_raster
        print("    raster", r.shape, "range", r.min(), r.max())
        l = self.full_labels
        print("    labels", l.shape, "range", l.min(), l.max())
        print("    unique labels", self.input_labels)
        print("    labelled range", self.labelled_range)

    def set_array_limits(self, limits):
        [(i, I), (j, J), (k, K)] = limits
        s = self.kj_stride
        self.limited_raster = self.full_raster[i:I, j:J:s, k:K:s]
        self.limited_labels = self.full_labels[i:I, j:J:s, k:K:s]

    def get_selection_array(self):
        selected = self.selected_label
        labels = self.limited_labels
        above0 = (labels > 0)
        nz_selected = np.choose(above0, [0, 1])
        # set value at 26 to 2
        chosen = (labels == selected)
        selection = np.choose(chosen, [nz_selected, 2])
        return selection

    def get_raster_array(self):
        f = h5py.File(self.raster_path_h5, "r")
        try:
            Data = f["Data"]
            self.full_raster = np.array(Data)
        finally:
            f.close()

    def get_labels_array(self):
        im = Image.open(self.labels_path_tiff)
        L = []
        for i, page in enumerate(ImageSequence.Iterator(im)):
            a = np.array(page)
            L.append(a)
        All = np.zeros( (len(L),) + L[0].shape, dtype=np.int)
        for (i, aa) in enumerate(L):
            All[i] = aa
        labels = self.input_labels = np.unique(All)
        selected = self.selected_label
        if not selected or selected not in labels:
            self.selected_label = max(labels)
        self.full_labels = All
        nzIJK = np.nonzero(All)
        self.labelled_range = [(nz.min(), nz.max()) for nz in nzIJK]

    def make_widget(self):
        self.left_label = widgets.HTML("Raster")
        self.left_area = widgets.VBox(children=[self.left_label])
        self.right_label = widgets.HTML("Labels")
        self.right_area = widgets.VBox(children=[self.right_label])
        self.container = widgets.HBox([
            self.left_area,
            self.right_area
        ])
        self.display_raster()
        self.display_labels()
        return self.container

    def volume_widget(self, ary, threshold):
        W = volume.Volume32()
        def on_render(change):
            if change['new']:
                W.load_3d_numpy_array(
                    ary, 
                    threshold=threshold,
                    di=self.di,
                    dj=self.dj,
                    dk=self.dk,
                )
                W.build(
                    width=self.width,
                )
        W.observe(on_render, names='rendered')
        return W

    def display_raster(self):
        ary = self.limited_raster
        threshold = 0.5 * (ary.max() + ary.min())  # TEMP
        W = self.volume_widget(ary, threshold)
        print ("displaying raster", self.folder)
        self.left_area.children = [self.left_label, W]

    def display_labels(self):
        ary = self.get_selection_array()
        threshold = 1.5
        W = self.volume_widget(ary, threshold)
        print ("displaying labels", self.folder)
        self.right_area.children = [self.right_label, W]

    def filepath(self, suffix):
        return os.path.join(self.folder, self.path_prefix + suffix)

    def path_must_exist(self, suffix):
        path = self.filepath(suffix)
        assert os.path.isfile(path), "Required regular file not found: " + repr(path)
        return path

class SliceComparison:
    def __init__(      
        self, 
        folder="/Users/awatters/misc/LisaBrown/mouse-embryo/mouse-embryo-nuclei", 
        path_prefix1="162954/162954",
        path_prefix2="163636/163636",
        ):
        self.folder = folder
        self.path_prefix1 = path_prefix1
        self.path_prefix2 = path_prefix2
        candidates = self.get_candidate_prefixes()
        """
        if path_prefix1 is None:
            for c in candidates:
                if c != path_prefix2:
                    path_prefix1 = c
                    break
        if path_prefix2 is None:
            for c in candidates:
                if c != path_prefix1:
                    path_prefix2 = c
                    break"""
        path_prefix1 = path_prefix1 or SliceHolder.dummy_prefix
        path_prefix2 = path_prefix2 or SliceHolder.dummy_prefix
        self.time_slice1 = None
        self.time_slice2 = None
        self.widget = None

    def build_widget_container(self):
        print("Building slice comparison widget...")
        volume.widen_notebook()
        self.title = "Nucleus registration in " + repr(self.folder)
        self.title_html = widgets.HTML(value=self.title)
        self.info = widgets.HTML(value="Slice Comparison initializing.")
        self.slice1_holder = SliceHolder(self)
        self.slice2_holder = SliceHolder(self)
        controls = self.make_controls()
        children = [
            self.title_html,
            self.slice1_holder.make_widget(),
            self.slice2_holder.make_widget(),
            controls,
            self.info,
        ]
        self.time_slice1 = self.load_slice(self.path_prefix1, self.slice1_holder)
        self.time_slice2 = self.load_slice(self.path_prefix2, self.slice2_holder)
        self.check_slices()
        self.widget = widgets.VBox(children=children)
        print("Build complete.")
        return self.widget

    def check_slices(self):
        self.info.value = ("Checking slices...")
        self.time_slice1 = self.slice1_holder.slice
        self.time_slice2 = self.slice2_holder.slice
        if self.interactive():
            self.info.value = ("Slices are loaded...")
            self.select_array_limits()
            self.slice1_holder.display_slice()
            self.slice2_holder.display_slice()
        else:
            self.info.value = ("Slices not ready for display. Please load slices.")

    def select_array_limits(self):
        ts1 = self.time_slice1
        ts2 = self.time_slice2
        r1 = ts1.labelled_range
        r2 = ts2.labelled_range
        r = [(min(m1, m2), max(M1, M2)) for [(m1, M1), (m2, M2)] in zip(r1, r2)]
        self.array_limits = r1
        self.info.value = "labelled array limits: " + repr(r)
        ts1.set_array_limits(r)
        ts2.set_array_limits(r)

    def load_slice(self, prefix, holder):
        print("loading slice", prefix)
        if prefix is not None:
            holder.set_slicing(prefix)
        else:
            holder.reset()

    def make_controls(self):
        temp = widgets.HTML("Controls area initializing...")
        self.controls_area = widgets.HBox(children=[temp])
        return self.controls_area

    def interactive(self):
        return (self.time_slice1 is not None) and (self.time_slice2 is not None) and (self.widget is not None)
    
    def get_candidate_prefixes(self):
        candidates = []
        folder = self.folder
        files = os.listdir(folder)
        for filename in files:
            if "." not in filename:
                testit = filename + "/" + filename
                testpath = os.path.join(folder, testit + "Labels.tiff")
                if os.path.isfile(testpath):
                    candidates.append(testit)
                else:
                    print ("not found: ", testpath)
        self.candidate_prefixes = candidates
        assert len(candidates) > 1, (
            "Folder must have more than 1 candidate subfolder for comparison: " +
            repr((self.folder, candidates))
        )
        for prefix in [self.path_prefix2, self.path_prefix1]:
            if prefix is not None:
                assert prefix in candidates, (
                    "Argument prefix is not among the candidate folders: " +
                    repr((prefix, candidates))
                )
        return candidates

class SliceHolder:

    dummy_prefix = "(None)"

    def __init__(self, holder):
        self.holder = holder
        self.prefix = None
        self.loading = False
        self.loaded = False
        self.slice = None

    def make_widget(self):
        self.info = widgets.HTML("Select a slicing folder.")
        candidates = [self.dummy_prefix] + self.holder.candidate_prefixes
        self.dropdown = widgets.Dropdown(options=candidates)
        self.dropdown.observe(self.dropdown_change)
        self.slice_area = widgets.VBox(children=[self.info])
        ly = widgets.Layout(border='solid')
        self.container = widgets.VBox([
            self.dropdown,
            self.slice_area,
        ], layout=ly)
        return self.container

    def display_slice(self):
        slice_widget = self.slice.make_widget()
        self.slice_area.children = [slice_widget, self.info]

    def dropdown_change(self, change):
        if change['type'] != 'change' or change.get("name") != 'value':
            return
        new = self.dropdown.value
        if not self.loading:
            self.set_slicing(new)
            self.holder.check_slices()

    def set_slicing(self, prefix):
        self.info.value = "Loading: " + repr(prefix)
        try:
            self.loading = True
            self.loaded = False
            self.slice = None
            try:
                self.slice = TimeSlice(
                    folder=self.holder.folder,
                    path_prefix=prefix,
                    holder=self,
                )
            except AssertionError as e:
                self.info.value = repr(e)
                self.dropdown.value = self.dummy_prefix
                return None
            self.prefix = prefix
            self.dropdown.value = prefix
            self.info.value = repr(prefix) + " slice info loaded"
            self.loaded = True
            return self.slice
        finally:
            self.loading = False

    def reset(self):
        self.info.value = "Please select a new slicing folder."
        self.slice_area.children = [self.info]
        

def smoke_test():
    print ("this will only work on Aaron's machine right now.")
    slice = TimeSlice()
    slice.print_info()

if __name__ == "__main__":
    smoke_test()

