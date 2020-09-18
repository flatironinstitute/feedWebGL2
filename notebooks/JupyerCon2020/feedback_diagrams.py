import numpy as np
# Import the nd_frame module and helper modules.
from jp_doodle import nd_frame, dual_canvas
from IPython.display import display
from feedWebGL2.volume import display_isosurface, widen_notebook
widen_notebook()


def processing_unit(swatch):
    swatch.frame_rect((0, 0, 0), w=2, h=2, color="rgba(200,200,0,0.2)")
    swatch.text((2.4, 1.3, 1), "uniforms", valign="center")
    swatch.arrow((2.3, 1.3, 1), (2, 1.4, 0),
                 color="rgba(0,200,200,0.5)", head_length=0.1, symmetric=True)


class DiagramBox:
    
    def __init__(self, x, y, z, w, h, texts, color, background, dz=0.3, font=None):
        if type(texts) is str:
            texts = texts.split()
        self.position = np.array([x,y,z], dtype=np.float)
        self.w = w
        self.h = h
        self.dz = 0.1
        self.texts = texts
        self.color = color
        self.background = background
        self.font=font
        
    def draw(self, on_frame):
        self.swatch = on_frame
        self.swatch.frame_rect(
            self.position,
            self.w, self.h,
            color=self.background
        )
        textpos = self.offset(0.5, 0.5, self.dz)
        texts = self.texts
        ntexts = len(texts)
        if ntexts>0:
            ddy = 1.0/(ntexts+1.0)
            for (i, text) in enumerate(texts):
                dy = 1.0 - (i + 1) * ddy
                textpos = self.offset(0.5, dy, self.dz)
                self.swatch.text(
                    textpos, text=text, color=self.color,
                    valign="center",
                    align="center",
                    font=self.font
                )
                
    def text(self, dx, dy, text, **other):
        pos = self.offset(dx, dy, self.dz)
        self.swatch.text(pos, text=text, **other)
        
    def offset(self, dx, dy, dz=0):
        shift = np.array([dx * self.w, dy * self.h, dz], dtype=np.float)
        return self.position + shift

class FeedbackDiagram:
    
    def __init__(self, dx=2, dy=1, shiftx=1, shifty=1, rows=1, cols=1, font=None):
        self.dx, self.dy, self.shiftx, self.shifty = dx, dy, shiftx, shifty
        self.rows, self.cols = rows, cols
        self.font = font
    
    def drawShader(self, i, j, fr, inst, vert, unif, text="Vertex Shader"):
        #x = self.dx * (i - self.shiftx)
        #y = self.dy * (self.shifty - j)
        x = self.dx * (j - self.shiftx)
        y = self.dy * (self.shifty - i)
        box = DiagramBox(x=x, y=y, z=1, 
                         w=self.dx * 0.8, h=self.dy * 0.8, 
                         texts=text.split(), color="red", 
                         background="rgba(100,255,100,0.8)", dz=0.3, font=self.font)
        box.draw(fr)
        if inst:
            fr.arrow(inst.offset(1, 0.1), box.offset(0.1, 0.1), 
                    color="green", head_length=0.1*self.dx)
        if vert:
            fr.arrow(vert.offset(0.1, 0), box.offset(0.1, 0.9), 
                    color="green", head_length=0.1*self.dx)
        if unif:
            fr.arrow(unif.offset(1, 0), box.offset(0.2, 0.7), 
                    color="green", head_length=0.1*self.dx)
        return box
    
    def drawFeedback(self, i, j, fr, sh, text="Feed back", background="rgba(200,200,100,0.8)"):
        #x = self.dx * (i - self.shiftx + self.rows)
        #y = self.dy * (self.shifty - j)
        x = self.dx * (j - self.shiftx + self.cols)
        y = self.dy * (self.shifty - i - 0.3)
        box = DiagramBox(x=x, y=y, z=1.5, 
                         w=self.dx * 0.8, h=self.dy * 0.8, 
                         texts=text.split(), color="blue", 
                         background=background, dz=0.3, font=self.font)
        box.draw(fr)
        fr.arrow(sh.offset(1, 0.2), box.offset(0.1, 0.2), 
                 color="green", head_length=0.1*self.dx)
    
    def drawVert(self, i, fr, text="Vertex Attributes"):
        x = self.dx * (i - self.shiftx)
        y = self.dy * (self.shifty + 1)
        box = DiagramBox(x=x, y=y, z=0.5, 
                         w=self.dx * 0.8, h=self.dy * 0.8, 
                         texts=text.split(), color="green", 
                         background="magenta", dz=0.3, font=self.font)
        box.draw(fr)
        return box
    
    def drawInst(self, j, fr, text="Instance Attributes", background="magenta"):
        x = self.dx * (-1 - self.shiftx)
        y = self.dy * (self.shifty - j)
        box = DiagramBox(x=x, y=y, z=0.5, 
                         w=self.dx * 0.8, h=self.dy * 0.8, 
                         texts=text.split(), color="green", background=background, dz=0.3, font=self.font)
        box.draw(fr)
        return box
    
    def drawUnif(self, i, fr, text="Uniforms and Textures"):
        x = self.dx * (-1 - self.shiftx)
        y = self.dy * (self.shifty + 1)
        box = DiagramBox(x=x, y=y, z=0.5, 
                         w=self.dx * 0.8, h=self.dy * 0.8, 
                         texts=text.split(), color="green", background="cyan", dz=0.3, font=self.font)
        box.draw(fr)
        return box

def feedback_outline():
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, font="15pt Arial")
    swatch = swatch3d(pixels=400, width=800, model_height=5.0)
    inst = FD.drawInst(0, fr=swatch)
    vert = None
    vert = FD.drawVert(0, fr=swatch)
    unif = FD.drawUnif(0, fr=swatch)
    sh = FD.drawShader(0, 0, fr=swatch, inst=inst, vert=vert, unif=unif)
    feed = FD.drawFeedback(0, 0, fr=swatch, sh=sh)
    swatch.fit(0.8)
    swatch.dedicated_frame.fit(margin=10)
    swatch.orbit_all(radius=4)

def stage1():
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, font="15pt Arial")
    swatch = swatch3d(pixels=800, width=1000, model_height=8.0)
    inst = FD.drawInst(0, fr=swatch)
    vert = FD.drawVert(0, fr=swatch)
    unif = FD.drawUnif(0, fr=swatch)
    sh = FD.drawShader(0, 0, fr=swatch, inst=inst, vert=vert, unif=unif)
    feed = FD.drawFeedback(0, 0, fr=swatch, sh=sh, text="Feed Back 1", background="rgba(200,200,100,0.8)")
    #swatch.fit(0.8)
    swatch.dedicated_frame.fit(margin=10)
    swatch.orbit_all(radius=4)

def matrix_multiplication():
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, font="15pt Arial")
    swatch = swatch3d(pixels=800, width=1000, model_height=8.0)
    inst = FD.drawInst(0, fr=swatch, text="row number")
    vert = FD.drawVert(0, fr=swatch, text="column number")
    unif = FD.drawUnif(0, fr=swatch, text="left_matrix right_matrix")
    sh = FD.drawShader(0, 0, fr=swatch, inst=inst, vert=vert, unif=unif, text="dot product")
    feed = FD.drawFeedback(0, 0, fr=swatch, sh=sh, text="row column entry", background="rgba(200,200,100,0.8)")
    #swatch.fit(0.8)
    swatch.dedicated_frame.fit(margin=10)
    swatch.orbit_all(radius=4)

def crossing_voxels():
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, font="15pt Arial")
    swatch = swatch3d(pixels=800, width=1000, model_height=8.0)
    inst = FD.drawInst(0, fr=swatch, text="Corners")
    #vert = FD.drawVert(0, fr=swatch)
    unif = FD.drawUnif(0, fr=swatch, text="Shape Threshold")
    sh = FD.drawShader(0, 0, fr=swatch, inst=inst, vert=None, unif=unif, text="Crossing Test")
    feed = FD.drawFeedback(0, 0, fr=swatch, sh=sh, text="Corners Indicator", background="rgba(200,200,100,0.8)")
    #swatch.fit(0.8)
    swatch.dedicated_frame.fit(margin=10)
    swatch.orbit_all(radius=4)

def triangulation():
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, font="15pt Arial")
    swatch = swatch3d(pixels=800, width=1000, model_height=8.0)
    inst = FD.drawInst(0, fr=swatch, text="Crossing Corners", background="rgba(200,200,100,0.8)")
    vert = FD.drawVert(0, fr=swatch, text="Vertex Index")
    unif = FD.drawUnif(0, fr=swatch, text="Shape Threshold")
    sh = FD.drawShader(0, 0, fr=swatch, inst=inst, vert=vert, unif=unif, text="Marching Tetrahedra")
    feed = FD.drawFeedback(0, 0, fr=swatch, sh=sh, text="Triangle Indicator")
    #swatch.fit(0.8)
    swatch.dedicated_frame.fit(margin=10)
    swatch.orbit_all(radius=4)

def stage2():
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, font="15pt Arial")
    swatch = swatch3d(pixels=800, width=1000, model_height=8.0)
    inst = FD.drawInst(0, fr=swatch, text="Feed Back 1", background="rgba(200,200,100,0.8)")
    vert = FD.drawVert(0, fr=swatch)
    unif = FD.drawUnif(0, fr=swatch)
    sh = FD.drawShader(0, 0, fr=swatch, inst=inst, vert=vert, unif=unif)
    feed = FD.drawFeedback(0, 0, fr=swatch, sh=sh, text="Feed Back 2")
    #swatch.fit(0.8)
    swatch.dedicated_frame.fit(margin=10)
    swatch.orbit_all(radius=4)

def trivial_pipeline():
    rows = 6
    cols = 1
    def ijn(n,i,j):
        return "%s:%s" % (n, i)
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, rows=rows, cols=cols)
    swatch = swatch3d(pixels=400, model_height=8.0)
    unif = FD.drawUnif(0, fr=swatch, text="shift")
    insts = [FD.drawInst(i, fr=swatch, text= "input "+repr(i)) for i in range(rows)]
    #verts = [FD.drawVert(j, fr=swatch, text= "Vert "+repr(j)) for j in range(cols)]
    shs = [[FD.drawShader(i, j, text=ijn("Shader",i,j), fr=swatch, inst=insts[i], vert=None, unif=unif)
                        for j in range(cols)] for i in range(rows)]
    feeds = [[FD.drawFeedback(i, j, fr=swatch, sh=shs[i][j], text=ijn("shift+ input",i,j))
                for j in range(cols)] for i in range(rows)]
    swatch.fit(0.8)
    swatch.orbit_all(radius=4)

def rotation_pipeline():
    rows = 6
    cols = 1
    def ijn(n,i,j):
        return "%s:%s" % (n, i)
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, rows=rows, cols=cols)
    swatch = swatch3d(pixels=400, model_height=8.0)
    unif = FD.drawUnif(0, fr=swatch, text="Matrix")
    insts = [FD.drawInst(i, fr=swatch, text= "vert "+repr(i)) for i in range(rows)]
    #verts = [FD.drawVert(j, fr=swatch, text= "Vert "+repr(j)) for j in range(cols)]
    shs = [[FD.drawShader(i, j, text=ijn("Shader",i,j), fr=swatch, inst=insts[i], vert=None, unif=unif)
                        for j in range(cols)] for i in range(rows)]
    feeds = [[FD.drawFeedback(i, j, fr=swatch, sh=shs[i][j], text=ijn("Rotated",i,j))
                for j in range(cols)] for i in range(rows)]
    swatch.fit(0.8)
    swatch.orbit_all(radius=4)

def instance_pipeline():
    rows = 6
    cols = 5
    def ijn(n,i,j):
        return "%s:%s:%s" % (n, i, j)
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, rows=rows, cols=cols)
    swatch = swatch3d(pixels=800, width=1000, model_height=10)
    unif = FD.drawUnif(0, fr=swatch, text="Matrix")
    insts = [FD.drawInst(i, fr=swatch, text= "Pos "+repr(i)) for i in range(rows)]
    verts = [FD.drawVert(j, fr=swatch, text= "Vert "+repr(j)) for j in range(cols)]
    shs = [[FD.drawShader(i, j, text=ijn("Sh",i,j), fr=swatch, inst=insts[i], vert=verts[j], unif=unif)
                        for j in range(cols)] for i in range(rows)]
    feeds = [[FD.drawFeedback(i, j, fr=swatch, sh=shs[i][j], text=ijn("Rot",i,j))
                for j in range(cols)] for i in range(rows)]
    swatch.text(location=[1,2,10], text="Vertex Geometry Shared by all chimps")
    swatch.text(location=[-3.5,1,10], text="Position differs for each chimp", degrees=-90)

    swatch.fit(0.9)
    swatch.orbit_all(radius=4)

def feedback_architecture():
    rows = 3
    cols = 4
    def ijn(n,i,j):
        return "%s(%s,%s)" % (n, i, j)
    FD = FeedbackDiagram(shiftx=0.5, shifty=0, rows=rows, cols=cols)
    swatch = nd_frame.swatch3d(pixels=800, model_height=8.0)
    unif = FD.drawUnif(0, fr=swatch, text="Uniforms/ Textures")
    insts = [FD.drawInst(i, fr=swatch, text= "Inst "+repr(i)) for i in range(rows)]
    verts = [FD.drawVert(j, fr=swatch, text= "Vert "+repr(j)) for j in range(cols)]
    shs = [[FD.drawShader(i, j, text=ijn("S",i,j), fr=swatch, inst=insts[i], vert=verts[j], unif=unif)
                        for j in range(cols)] for i in range(rows)]
    feeds = [[FD.drawFeedback(i, j, fr=swatch, sh=shs[i][j], text=ijn("F",i,j))
                for j in range(cols)] for i in range(rows)]
    swatch.fit(0.8)
    swatch.orbit_all(radius=4)

def swatch3d(
    pixels=500,
    model_height=2.0,
    cx=0,
    cy=0,
    auto_show=True,
    width=None,
    font="12pt Arial"
    ):
    pixel_height = pixels
    if width is None:
        width = pixels
    dc_config = {
        "width": width,
        "height": pixel_height,
    }
    canvas = dual_canvas.DualCanvasWidget(width=width, height=pixel_height, config=dc_config, font=font)
    hradius = model_height * 0.5
    #print("hradius", hradius)
    wradius = (hradius / pixel_height) * width
    frame = canvas.frame_region(
        0, 0, width, pixel_height,
        cx-wradius, cy-hradius, cx+wradius, cy+hradius)
    result = nd_frame.ND_Frame(canvas, frame)
    if auto_show:
        result.show()
    return result

voxel_grid_css = """
.voxelsgrid {
    display: grid;
    grid-template-columns: %s;
    grid-gap: 10px;
}
""" % (
    (" auto" * 37),
)

def voxel_grid_entry(text, row, col, background_color="pink", col_span=None):
    gridcol = str(col)
    if col_span:
        gridcol = "%s / span %s" % (col, col_span)
    style = "background-color: %s; grid-row: %s; grid-column: %s" % (background_color, row, gridcol)
    #style = "background-color: cyan;"
    return '<div style="%s">%s</div>' % (style, text)

def voxel_grid_html():
    from IPython.display import HTML
    L = []
    a = L.append
    a("<style>")
    a(voxel_grid_css)
    a("</style>")
    a('<div class="voxelsgrid">')
    a(voxel_grid_entry("tet", row=1, col=1, background_color="white"))
    for tet in range(6):
        a(voxel_grid_entry("tetrahedron %s" % tet, row=1, col=tet * 6 + 2, col_span=6))
    a(voxel_grid_entry("tri", row=2, col=1, background_color="white"))
    for tet in range(6):
        for tri in range(2):
            a(voxel_grid_entry("triangle%s:%s" % (tet, tri), row=2, col=tet*6+tri*3+2, col_span=3, background_color="salmon"))
    a(voxel_grid_entry("v", row=3, col=1, background_color="white"))
    for tet in range(6):
        for tri in range(2):
            for vert in range(3):
                a(voxel_grid_entry("V%s:%s:%s" % (tet, tri, vert), row=3, col=tet*6+tri*3+vert+2, background_color="#fee"))
    for c in range(13):
        r = c + 4
        a(voxel_grid_entry("C%s" % c, row=r, col=1, background_color="pink"))
        for tet in range(6):
            for tri in range(2):
                for vert in range(3):
                    a(voxel_grid_entry("V%s:%s:%s" % (tet, tri, vert), row=r, col=tet*6+tri*3+vert+2, background_color="#afa"))
    a("</div>")
    htmlstr = "\n".join(L)
    #print(htmlstr)
    return HTML(htmlstr)

def feedback_objects():
    swatch = swatch3d(pixels=700, model_height=8.0, font="20pt Courier")

    def hbox(x, y, z, w, h, text, color, background, dx=0.1, dy=0.1):
        b = DiagramBox(x, y, z, w, h, "", color, background)
        b.draw(swatch)
        b.text(dx, 1-dy, text, color=color)
        return b

    context = hbox(-3, -3, 0, 6, 6, "Context", "green", "#eed", dy=0.05, dx=0.05)

    def buffer(x, y, txt="Buffer", background="#aaf"):
        w, h = 1,4
        b = hbox(x, y, 3, 4, 0.5, txt, "black", background, dy=0.3, dx=0.02)
        offsets = []
        for i in range(10):
            c = b.offset(0.1 + i * 0.08, 0.4)
            offsets.append(c)
            swatch.circle(c, 5, "#ddd")
        b.offsets = offsets
        return b
        
    b1 = buffer(-2, 2)
    b2 = buffer(-2, 1.3)
    ab = buffer(-1, 3.1, "JS Input ArrayBuffer", background="#e8e")
    swatch.arrow(ab.offsets[0], b1.offsets[0], 
                    color="green", head_length=0.1)


    fb = buffer(-2, -2.7, "Feedback buffer")
    program = hbox(-2.5, -2, 1, 5, 3, "Program", "blue", "#fd9", dy=0.05, dx=0.05)

    runner = hbox(-2.4, -0.9, 1.2, 4.5, 1.5, "Runner", "red", "#9fd", dy=0.1, dx=0.05)

    (x,y,z) = runner.offset(0.05, 0.1)
    vi = DiagramBox(x, y, z=1.3, w=2, h=1, texts="vertex input", color="black", background="#ddd")
    vi.draw(swatch)

    (x,y,z) = runner.offset(0.51, 0.1)
    ii = DiagramBox(x, y, z=1.3, w=2, h=1, texts="instance input", color="black", background="#ddd")
    ii.draw(swatch)

    (x,y,z) = program.offset(0.1, 0.1)
    fbv = hbox(x, y, 1.2, 4, 0.5, "feedback", "black", "#ddd", dy=0.7)

    oab = buffer(-1, -3.7, "JS Output ArrayBuffer", background="#e8e")
    swatch.arrow(fb.offsets[0], oab.offsets[0], 
                    color="green", head_length=0.1)

    swatch.arrow(fbv.offset(0.5,0.5), fb.offsets[0], 
                    color="green", head_length=0.1)

    swatch.arrow(b1.offsets[3], ii.offset(0.5,0.5), 
                    color="green", head_length=0.1)
    swatch.arrow(b2.offsets[0], vi.offset(0.5,0.5), 
                    color="green", head_length=0.1)
    swatch.fit(0.8)

    from numpy.linalg import norm

def tetrahedronPts(t_indices, color, swatch=None, pixels=500, focus=None):
    if swatch is None:
        swatch = nd_frame.swatch3d(pixels=pixels, model_height=4.0, auto_show=True)

        # rotate the 3d reference frame a bit so we aren't looking straight into the z axis
        swatch.orbit(center3d=(0,0,0), radius=3, shift2d=(-1, -0.8))
        # Allow the user to rotate the figure using dragging
        swatch.orbit_all(radius=2)
    s = sum(t_indices)
    def ss(x):
        return x * 0.9 + s * 0.1
    for i in range(4):
        pi = t_indices[i]
        for j in range(i+1,4):
            pj = t_indices[j]
            if focus is not None:
                #M = float(max(norm(pi-focus), norm(pj-focus)))
                if norm(pi-focus)>0.1 and norm(pj-focus)>0.1:
                    continue
            swatch.line(ss(pi), ss(pj), color)
    return swatch

def vec3(x,y,z):
    return np.array([x,y,z], dtype=np.float)

def tetrahedral_tiling():
    null_offset = vec3(0.0, 0.0, 0.0)
    full_offset = vec3(1.0, 1.0, 1.0)
    mid_offsets = (
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 1.0, 1.0),
        vec3(0.0, 1.0, 0.0),
        vec3(1.0, 1.0, 0.0),
        vec3(1.0, 0.0, 0.0),
        vec3(1.0, 0.0, 1.0),
        vec3(0.0, 0.0, 1.0),
    )
    swatch = None
    colors = "red green blue cyan magenta brown".split()
    for i in range(6):
        pts = [null_offset, mid_offsets[i], mid_offsets[i+1], full_offset]
        swatch = tetrahedronPts(pts, colors[i], swatch)
    # add numbers
    numbers = [1.1, 1.2, 1.0, 1.1, -2.1, -1.6, 1.3, 1.7, 1.8]
    r = [-0.03, 1.03]
    count = 0
    for x in r:
        for y in r:
            for z in r:
                n = numbers[count]
                color = "green"
                background = "cyan"
                if (n < 0):
                    color = "red"
                    background = "yellow"
                swatch.text((x,y,z), repr(n), color=color, align="center", background=background)
                count = count + 1
    swatch.fit(0.5)

def alt_tiling():
    As = (vec3(0.0,0.0,1.0),vec3(1.0,1.0,0.0),vec3(1.0,0.0,1.0),vec3(0.0,1.0,1.0),vec3(0.0,0.0,0.0))
    Bs = (vec3(0.0,1.0,0.0),vec3(0.0,1.0,0.0),vec3(1.0,0.0,0.0),vec3(0.0,0.0,1.0),vec3(1.0,0.0,0.0))
    Cs = (vec3(1.0,0.0,0.0),vec3(1.0,1.0,1.0),vec3(1.0,1.0,1.0),vec3(1.0,1.0,1.0),vec3(0.0,1.0,0.0))
    Ds = (vec3(1.0,1.0,1.0),vec3(1.0,0.0,0.0),vec3(0.0,0.0,1.0),vec3(0.0,1.0,0.0),vec3(0.0,0.0,1.0))

    def indices(letter, vectors):
        indices = []
        for vector in vectors:
            index = 0
            for v in vector:
                index = index << 1
                if v>0.1:
                    index += 1
            indices.append(index)
        #print("const int", letter+"_index = int[]", tuple(indices), ";")
        
    indices("A", As)
    indices("B", Bs)
    indices("C", Cs)
    indices("A", Ds)
    swatch = None
    colors = "red green blue orange magenta brown".split()
    for i in range(5):
        pts = [As[i], Bs[i], Cs[i], Ds[i]]
        swatch = tetrahedronPts(pts, colors[i], swatch)
        swatch.text((0,0,0), "origin")
    swatch.fit(0.5)

def tetrahedron(weights=[-1,1,1,1]):
    # Make a swatch but don't automatically show it in the notebook.
    swatch = nd_frame.swatch3d(pixels=300, model_height=4.0, auto_show=True)
    
    # rotate the 3d reference frame a bit so we aren't looking straight into the z axis
    swatch.orbit(center3d=(0,0,0), radius=3, shift2d=(-1, -0.8))
    # Allow the user to rotate the figure using dragging
    swatch.orbit_all(radius=2)
    for i in range(4):
        pi = t_indices[i]
        textcolor = "blue"
        if weights and weights[i] > 0:
            textcolor = "red"
        label = names[i] + ":" + repr(weights[i])
        swatch.text(pi * 1.1, label, textcolor, align="center", valign="center",
                   background="yellow")
        for j in range(i+1,4):
            pj = t_indices[j]
            swatch.line(pi, pj, "green")
    return swatch

A,B,C,D = 0,1,2,3
eg_triangles = [
    [(A,C),(B,C),(A,D)],
    [(A,D),(B,C),(B,D)]
]

def triangulated(triangles=eg_triangles, weights=[1.1,1.2,-1.2,-1.1]):
    swatch = tetrahedron(weights)
    seen = {}
    for pairs in triangles:
        interpolated = []
        labels = []
        for pair in pairs:
            (i,j) = sorted(pair)
            pi = t_indices[i]
            pj = t_indices[j]
            label = names[i] + names[j] + ":0"
            intij = pi * 0.4 + pj * 0.6
            interpolated.append(intij)
            labels.append((intij, label))
        s = 0
        for interp in interpolated:
            s += interp
        c = s / 3.0
        v,w,u = interpolated
        cr = np.cross(v-w, v-u)
        n = cr / np.linalg.norm(cr)
        swatch.arrow(c+0.1*cr, c+cr, color="cyan", head_length=0.1, symmetric=True)
        for (pt, label) in labels:
            if label not in seen:
                swatch.text(pt + c * 0.2, label, "magenta", 
                            align="center", valign="center", background="cyan")
                seen[label] = 1
        shifted = [list(interp * 0.9 + c * 0.1) for interp in interpolated]
        swatch.polygon(shifted, color="rgba(0,0,255,0.5)")

def triangulated1():
    return triangulated(triangles=[[(A,C),(A,B),(A,D)]], weights=[1,-1,-1,-1])
    
def t_midpoint(i,j):
    pi = t_indices[i]
    pj = t_indices[j]
    return pi * 0.5 + pj * 0.5

import numpy as np

t_indices = np.array([
    (1,1,1),
    (1,-1,-1),
    (-1,1,-1),
    (-1,-1,1),
], dtype=np.float)

names = "ABCD"
