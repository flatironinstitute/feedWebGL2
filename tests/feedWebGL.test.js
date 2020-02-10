

// var index = require('../dist/index');
import feedWebGL_is_loaded from "../dist/index";

describe('testing feedWebGL', () => {

    it('loads the feedWebGL index', () => {
        //expect(true).toEqual(true);
        expect(feedWebGL_is_loaded()).toBe(true);
    });

    it('creates a context', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        expect(context.gl).toBeTruthy();
    });

    it('allocates a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        expect(buffer.name).toBeTruthy();
        expect(context.buffers[buffer.name]).toEqual(buffer);
    });

    it('sizes a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        buffer.allocate_size(13);
        expect(buffer.byte_size).toEqual(4*13);
    });

    it('initializes a buffer from an array', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var buffer = context.buffer(null, 4);
        var valuesArray = new Float32Array([1,2,3,3,5]);
        buffer.initialize_from_array(valuesArray);
        expect(buffer.byte_size).toEqual(4*5);
    });

    it('creates a program', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        expect(program.gl_program).toBeNull();
        expect(context.programs[program.name]).toEqual(program);
    });

    it('compiles and links a program', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:true};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        expect(program.gl_program).toBeTruthy();
        expect(context.programs[program.name]).toEqual(program);
    });

    it('fails a compile', () => {
        var mockoptions = {fail_compile: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        expect(program.name).toBeTruthy();
        var compile_fn = (() => program.compile());
        expect(compile_fn).toThrow()
        var check_fn = (() => program.check_error());
        expect(check_fn).toThrow()
    });

    it('fails a link', () => {
        var mockoptions = {fail_link: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {vertex_shader: shader, compile_now:false};
        var program = context.program(options);
        var compile_fn = (() => program.compile());
        expect(compile_fn).toThrow()
        expect(program.error).toEqual("Error linking shader program");
    });

    it('makes feedback variables', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 2},
            },
        };
        var program = context.program(options);
        var fA = program.feedbacks_by_name.feedback_A;
        var fB = program.feedbacks_by_name.feedback_B;
        expect(fA).toBeTruthy();
        expect(fB).toBeTruthy();
        expect(program.feedback_order[fA.index]).toEqual(fA);
        expect(fA.num_components).toEqual(3);
        expect(fB.bytes_per_component).toEqual(2);
        var fvs = program.feedback_variables();
        expect(fvs[fB.index]).toEqual("feedback_B");
    });

    it('makes a runner', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
        };
        var program = context.program(options);
        var runr = program.runner(1000000);
        expect(runr.name).toBeTruthy();
        expect(program.runners[runr.name]).toBe(runr);
        expect(runr.num_instances).toBe(1000000);
    });

    it('allocates feedback buffers', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            feedbacks: {
                feedback_A: {num_components: 3},
                feedback_B: {bytes_per_component: 2},
            },
        };
        var program = context.program(options);
        var runr = program.runner(100, 4);
        runr.allocate_feedback_buffers();
        var allocated = runr.allocated_feedbacks;
        var allocated_A = allocated.feedback_A;
        expect(allocated_A.runner).toBe(runr);
        expect(allocated_A.name).toBe("feedback_A");
        // instances * vertices * ncomponents * bytes
        expect(allocated_A.buffer_bytes).toBe(100 * 4 * 3 * 4);
    });

    it('creates vector and matrix uniforms', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            uniforms: {
                translation: {
                    vtype: "4fv",
                    default_value: [-1, -1, -1, 0],
                },
                affine_transform: {
                    vtype: "4fv",
                    is_matrix: true,
                    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                },
            },
        };
        var program = context.program(options);
        var run = program.runner(1000000);
        var uniforms = run.uniforms;
        var t = uniforms.translation;
        var a = uniforms.affine_transform;
        expect(t.name).toEqual("translation")
        expect(t.vtype).toEqual("4fv")
        expect(t.is_matrix()).toBe(false);
        expect(a.is_matrix()).toBe(true);
        expect(t.value).toEqual([-1, -1, -1, 0]);
    });

    it('installs uniforms', () => {
        var mockoptions = {dump_methods: true};
        mockCanvas(window, mockoptions);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            uniforms: {
                translation: {
                    vtype: "4fv",
                    default_value: [-1, -1, -1, 0],
                },
                affine_transform: {
                    vtype: "4fv",
                    is_matrix: true,
                    default_value: [0,1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1, ],
                },
            },
        };
        var program = context.program(options);
        var run = program.runner(1000000);
        run.install_uniforms();
        var uniforms = run.uniforms;
        var t = uniforms.translation;
        var a = uniforms.affine_transform;
        expect(t.location).toBeTruthy();
        expect(a.location).toBeTruthy();
    });

    it('creates mesh and vertex inputs', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            inputs: {
                "location": {
                    num_components: 3,
                },
                "scale": {},  // implicitly just one component
                "point_offset":  {
                    per_vertex: true,  // repeat for every mesh
                    num_components: 3,
                },
            },
        };
        var program = context.program(options);
        var runr = program.runner(1000000);
        var inputs = runr.inputs;
        var l = inputs.location;
        var s = inputs.scale;
        var p = inputs.point_offset;
        expect(s.name).toEqual("scale");
        expect(p.runner).toBe(runr);
        expect(s.num_components).toEqual(1);
        expect(l.num_components).toEqual(3);
        expect(l.is_mesh_input()).toEqual(true);
        expect(p.is_mesh_input()).toEqual(false);
    });

    it('binds mesh and vertex inputs to a buffer', () => {
        mockCanvas(window);
        var d = jQuery("<div/>");
        var context = d.feedWebGL2();
        var shader = "bogus shader for smoke-testing only";
        var options = {
            vertex_shader: shader,
            inputs: {
                "location": {
                    num_components: 3,
                },
                "scale": {},  // implicitly just one component
                "point_offset":  {
                    per_vertex: true,  // repeat for every mesh
                    num_components: 3,
                },
            },
        };
        var program = context.program(options);
        var runr = program.runner(1000000);
        var inputs = runr.inputs;
        var l = inputs.location;
        var s = inputs.scale;
        var p = inputs.point_offset;
        var buffer = context.buffer(null, 4);
        var valuesArray = new Float32Array([1,2,3,3,5]);
        buffer.initialize_from_array(valuesArray);
        p.bindBuffer(buffer);
        s.bindBuffer(buffer, 2, 1);
        expect(s.byte_offset).toEqual(2 * 1 * 4);
    });

  });
