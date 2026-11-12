import bpy, sys
args = sys.argv[sys.argv.index('--')+1:]
for path in args:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    print('FILE', path)
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            print('  MESH', o.name, 'tris', len(o.data.loop_triangles), 'verts', len(o.data.vertices), 'mats', [m.name for m in o.data.materials], 'vgroups', len(o.vertex_groups), 'dims', [round(d,2) for d in o.dimensions])
        elif o.type == 'ARMATURE':
            print('  ARM', o.name, 'bones', len(o.data.bones), 'scale', tuple(round(s,3) for s in o.scale))
            print('   ', [b.name for b in o.data.bones][:90])
        else:
            print('  OBJ', o.type, o.name)
    for a in bpy.data.actions:
        print('  ACTION', a.name, a.frame_range[:])
    for i in bpy.data.images: print('  IMG', i.name, i.filepath)
