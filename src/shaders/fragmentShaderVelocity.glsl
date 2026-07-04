/*
 * fragmentShaderVelocity.glsl
 *
 * Shader GPGPU per aggiornare la velocità dei boids.
 *
 * Ogni pixel della texture rappresenta un boid.
 *
 * Regole multi-specie:
 *
 * - Separation:
 *   applicata tra tutti i boids, anche di specie diverse.
 *   Serve a evitare sovrapposizioni e collisioni visive.
 *
 * - Alignment:
 *   applicata solo tra boids della stessa specie.
 *   Serve a far sì che ogni specie sviluppi una propria direzione
 *   collettiva.
 *
 * - Cohesion:
 *   applicata solo tra boids della stessa specie.
 *   Serve a far sì che ogni specie formi un proprio stormo.
 *
 * Le specie sono calcolate a partire dall'indice del boid:
 *
 * speciesIndex = floor(birdIndex * speciesCount / boidCount)
 *
 * In questo modo i boids sono divisi in modo uniforme tra le specie.
 */

uniform float time;
uniform float testing;
uniform float delta;

uniform float separationDistance;
uniform float alignmentDistance;
uniform float cohesionDistance;

uniform vec3 predator;

uniform float boidCount;
uniform float speciesCount;

const float width = resolution.x;
const float height = resolution.y;

const float PI = 3.141592653589793;
const float PI_2 = PI * 2.0;

float zoneRadius = 40.0;
float zoneRadiusSquared = 1600.0;

float separationThresh = 0.45;
float alignmentThresh = 0.65;

const float UPPER_BOUNDS = BOUNDS;
const float LOWER_BOUNDS = -UPPER_BOUNDS;

const float SPEED_LIMIT = 9.0;

float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

float getBirdIndex(vec2 uv) {
    vec2 pixel = floor(uv * resolution.xy);
    return pixel.y * resolution.x + pixel.x;
}

float getSpecies(float birdIndex) {
    return floor(birdIndex * speciesCount / boidCount);
}

void main() {

    zoneRadius = separationDistance + alignmentDistance + cohesionDistance;
    separationThresh = separationDistance / zoneRadius;
    alignmentThresh = (separationDistance + alignmentDistance) / zoneRadius;
    zoneRadiusSquared = zoneRadius * zoneRadius;

    vec2 uv = gl_FragCoord.xy / resolution.xy;

    float selfIndex = getBirdIndex(uv);

    if (selfIndex >= boidCount) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float selfSpecies = getSpecies(selfIndex);

    vec3 birdPosition;
    vec3 birdVelocity;

    vec3 selfPosition = texture2D(texturePosition, uv).xyz;
    vec3 selfVelocity = texture2D(textureVelocity, uv).xyz;

    float dist;
    vec3 dir;
    float distSquared;

    float f;
    float percent;

    vec3 velocity = selfVelocity;
    float limit = SPEED_LIMIT;

    /*
     * Fuga dal predatore.
     * Il predatore è controllato dal mouse.
     */
    dir = predator * UPPER_BOUNDS - selfPosition;
    dir.z = 0.0;

    dist = length(dir);
    distSquared = dist * dist;

    float preyRadius = 150.0;
    float preyRadiusSq = preyRadius * preyRadius;

    if (dist < preyRadius) {
        f = (distSquared / preyRadiusSq - 1.0) * delta * 100.0;
        velocity += normalize(dir) * f;
        limit += 5.0;
    }

    /*
     * Richiamo verso il centro della scena.
     */
    vec3 central = vec3(0.0, 0.0, 0.0);

    dir = selfPosition - central;
    dist = length(dir);

    dir.y *= 2.5;

    if (dist > 0.0001) {
        velocity -= normalize(dir) * delta * 5.0;
    }

    /*
     * Confronto con tutti gli altri boids.
     * I pixel oltre boidCount vengono ignorati.
     */
    for (float y = 0.0; y < height; y++) {
        for (float x = 0.0; x < width; x++) {

            float otherIndex = y * width + x;

            if (otherIndex >= boidCount) continue;
            if (otherIndex == selfIndex) continue;

            vec2 ref = vec2(x + 0.5, y + 0.5) / resolution.xy;

            birdPosition = texture2D(texturePosition, ref).xyz;

            dir = birdPosition - selfPosition;
            dist = length(dir);

            if (dist < 0.0001) continue;

            distSquared = dist * dist;

            if (distSquared > zoneRadiusSquared) continue;

            percent = distSquared / zoneRadiusSquared;

            float otherSpecies = getSpecies(otherIndex);
            bool sameSpecies = selfSpecies == otherSpecies;

            if (percent < separationThresh) {

                /*
                 * Separation:
                 * applicata anche tra specie diverse.
                 */
                f = (separationThresh / percent - 1.0) * delta;
                velocity -= normalize(dir) * f;

            } else if (percent < alignmentThresh) {

                /*
                 * Alignment:
                 * applicato solo tra boids della stessa specie.
                 *
                 * Se l'allineamento resta globale, specie diverse
                 * continuano a orientarsi insieme e tendono a mescolarsi.
                 */
                if (sameSpecies) {
                    float threshDelta = alignmentThresh - separationThresh;
                    float adjustedPercent = (percent - separationThresh) / threshDelta;

                    birdVelocity = texture2D(textureVelocity, ref).xyz;

                    f = (0.5 - cos(adjustedPercent * PI_2) * 0.5 + 0.5) * delta;
                    velocity += normalize(birdVelocity) * f;
                }

            } else {

                /*
                 * Cohesion:
                 * applicata solo tra boids della stessa specie.
                 */
                if (sameSpecies) {
                    float threshDelta = 1.0 - alignmentThresh;
                    float adjustedPercent;

                    if (threshDelta == 0.0) {
                        adjustedPercent = 1.0;
                    } else {
                        adjustedPercent = (percent - alignmentThresh) / threshDelta;
                    }

                    f = (0.5 - (cos(adjustedPercent * PI_2) * -0.5 + 0.5)) * delta;
                    velocity += normalize(dir) * f;
                }
            }
        }
    }

    /*
     * Limite massimo alla velocità.
     */
    if (length(velocity) > limit) {
        velocity = normalize(velocity) * limit;
    }

    gl_FragColor = vec4(velocity, 1.0);
}