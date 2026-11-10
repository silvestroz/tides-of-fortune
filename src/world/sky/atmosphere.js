// Global aerial-perspective fog. Importing this module patches THREE.ShaderChunk fog chunks so EVERY material
// with fog:true (built-in or ShaderMaterial using #include <fog_*>) gets:
//   - exponential distance fog (density = scene.fog.density, a THREE.FogExp2) attenuated with height,
//   - sun-direction in-scattering (fog warms/brightens toward the sun, matching the sky dome's horizon glow).
// Extra uniforms are shared by reference (plain {x,y,z} objects are not cloned by UniformsUtils), so they update
// globally. A ShaderMaterial built without them simply gets zeros and falls back to plain exp fog.
//   - layered aerial perspective: land and ships above the waterline turn cooler / bluer at mid fog depth (painted
//     receding ridges) before dissolving into the horizon colour; the sea itself (near y = 0) is left alone.
//   ATMOS.sunDir {x,y,z}, ATMOS.sunGlow {x,y,z} (linear rgb),
//   ATMOS.params {x: heightFalloff, y: glowPower, z: minFog, w: layered-haze strength (set by PostFX for the sea scene only)}
import * as THREE from 'three';

export const ATMOS = {
  sunDir: { x: 0, y: 1, z: 0 },
  sunGlow: { x: 0, y: 0, z: 0 },
  params: { x: 1 / 260, y: 6.0, z: 0.0, w: 0.0 },
};

const extraUniforms = {
  fogSunDir: { value: ATMOS.sunDir },
  fogSunGlow: { value: ATMOS.sunGlow },
  fogAtmos: { value: ATMOS.params },
};

// Inject into the lib so later merges carry the shared references.
Object.assign(THREE.UniformsLib.fog, extraUniforms);
for (const k in THREE.ShaderLib) {
  const u = THREE.ShaderLib[k].uniforms;
  if (u && u.fogColor) Object.assign(u, extraUniforms);
}

THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldDelta;
#endif
`;
THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldDelta = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldDelta;
	uniform vec3 fogSunDir;
	uniform vec3 fogSunGlow;
	uniform vec4 fogAtmos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	{
		float fogDist = length( vFogWorldDelta );
		vec3 fogV = vFogWorldDelta / max( fogDist, 1e-3 );
		#ifdef FOG_EXP2
			float fogOD = fogDensity * fogDist;
			if ( fogAtmos.x > 0.0 ) {
				// integrate exp(-k*h) along the ray from the camera (height h0) to the fragment
				float k = fogAtmos.x;
				float h0 = max( cameraPosition.y, 0.0 );
				float dh = vFogWorldDelta.y;
				float hf = abs( dh ) > 0.5 ? ( exp( -k * h0 ) - exp( -k * max( h0 + dh, 0.0 ) ) ) / ( k * dh ) : exp( -k * h0 );
				fogOD *= clamp( hf, 0.0, 1.0 );
			}
			float fogFactor = 1.0 - exp( -fogOD );
			fogFactor = max( fogFactor, fogAtmos.z * smoothstep( 0.0, 400.0, fogDist ) );
		#else
			float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		float fogMu = max( dot( fogV, fogSunDir ), 0.0 );
		vec3 fogCol = fogColor + fogSunGlow * ( pow( fogMu, max( fogAtmos.y, 1.0 ) ) * 0.8 + pow( fogMu, 48.0 ) * 0.6 );
		if ( fogAtmos.w > 0.0 ) {
			// receding layers: a cool, slightly darker veil peaking at mid fog depth, strongest away from the sun
			float fogY = cameraPosition.y + vFogWorldDelta.y;
			float fogLayer = fogFactor * ( 1.0 - fogFactor ) * 4.0 * smoothstep( 1.5, 12.0, fogY ) * ( 1.0 - fogMu * fogMu );
			fogCol = mix( fogCol, fogColor * vec3( 0.58, 0.74, 0.98 ) + vec3( 0.0, 0.005, 0.016 ), clamp( fogLayer * fogAtmos.w, 0.0, 1.0 ) );
		}
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, clamp( fogFactor, 0.0, 1.0 ) );
	}
#endif
`;
