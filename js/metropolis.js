var audioContext = null;
var isPlaying = false;      // Are we currently playing?
var startTime;              // The start time of the entire sequence.
var current16thNote;        // What note is currently last scheduled?
var lookahead = 25.0;       // How frequently to call scheduling function (ms)
var scheduleAheadTime = 0.1;    // How far ahead to schedule audio (sec)
var tempo;
// This is calculated from lookahead, and overlaps
// with next interval (in case the timer is late)
var nextNoteTime = 0.0;     // when the next note is due.
var noteResolution = 0;     // 0 == 16th, 1 == 8th, 2 == quarter note
var gateLength = 0.3; // relative note length
var timerID = 0;            // setInterval identifier.
var oscillators = [];
var masterGain,
    masterDelay,
    wetLevel,
    masterFilter;

var canvas,                 // the canvas element
canvasContext;          // canvasContext is the canvas' context 2D
var last16thNoteDrawn = -1; // the last "box" we drew on the screen
var notesInQueue = [];      // the notes that have been put into the web audio,
                            // and may or may not have played yet. {note, time}
var MODES = {
  'REST': 0,
  'SINGLE': 1,
  'REPEAT': 2,
  'HOLD': 3
};

var notes = Note.fromLatin('G3').scale('natural minor');
var DEFAULT_STEPS = [
  // mode = numeric mode
  // repeats = num times to play or length to hold
  // note = frequency
  { mode: MODES['SINGLE'], repeats: 1, note: notes[0].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[1].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[2].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[3].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[4].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[5].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[6].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[7].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[0].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[1].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[2].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[3].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[4].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[5].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[6].frequency() },
  { mode: MODES['SINGLE'], repeats: 1, note: notes[7].frequency() }
]


// First, let's shim the requestAnimationFrame API, with a setTimeout fallback
window.requestAnimFrame = (function(){
  return  window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
      window.mozRequestAnimationFrame ||
        window.oRequestAnimationFrame ||
          window.msRequestAnimationFrame ||
            function( callback ){
    window.setTimeout(callback, 1000 / 60);
  };
})();

function nextNote(advance) {
  // Advance current note and time by a 16th note...
  var secondsPerBeat = 60.0 / tempo;    // Notice this picks up the CURRENT
  // tempo value to calculate beat length.
  nextNoteTime += 0.25 * secondsPerBeat;    // Add beat length to last beat time

  if(advance != false) {
    current16thNote++;    // Advance the beat number, wrap to zero
    if (current16thNote == 16) {
      current16thNote = 0;
    }
  }
}

function scheduleNote(beatNumber, time, noteHertz, rest, lengthMultiplier){
  // push the note on the queue, even if we're not playing.
  notesInQueue.push( { note: beatNumber, time: time } );
  if(typeof(lengthMultiplier) === 'undefined') lengthMultiplier = 1;

  if ( (noteResolution==1) && (beatNumber%2))
    return; // we're not playing non-8th 16th notes
  if ( (noteResolution==2) && (beatNumber%4))
    return; // we're not playing non-quarter 8th notes

  if(!rest) {
    // create an oscillator
    var osc = new Oscillator(audioContext, noteHertz),
        gain = audioContext.createGain(),
        attackTime = 0.02,
        releaseTime = 0.01,
        trueNoteLength = noteLength() * lengthMultiplier,
        noteEnd = time + attackTime + trueNoteLength + releaseTime;

    osc.connect(gain);
    gain.connect(masterGain);


    gain.gain.value = 0;

    gain.gain.cancelScheduledValues(time);
    gain.gain.linearRampToValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.8, time + attackTime);
    gain.gain.linearRampToValueAtTime(0, noteEnd);

    osc.start(time);
    osc.stop(noteEnd);
    oscillators.push(osc);
  }
}

function noteLength() {
  return (60.0 / tempo) * gateLength;
}

// Randomly change all step values
function randomize() {
  for(var step in stepInstructions) {
    var note = notes[randomNumberInRange(notes.length)].frequency();

    stepInstructions[step].mode = randomNumberInRange(4);
    stepInstructions[step].repeats = randomNumberInRange(8, 1);
    stepInstructions[step].note = note;
  }
  console.table(stepInstructions);
}

function reset() {
  stepInstructions = JSON.parse(JSON.stringify(DEFAULT_STEPS));
}

function randomNumberInRange(range, min) {
  var num = Math.floor(Math.random() * range);
  var min = min || 0;

  return min < num ? num : min;
}

function scheduler() {
  // while there are notes that will need to play before the next interval,
  // schedule them and advance the pointer.
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime ) {
    var config = stepInstructions[current16thNote];

    // cleanup this brainfart
    // could make nextNote do the scheduleNote work inside. pass all the args
    if(config.mode == MODES['HOLD']) {
      scheduleNote(current16thNote, nextNoteTime, config.note, config.mode == MODES['REST'], config.repeats);
      for(var i = 0; i < config.repeats; i++) {
        nextNote(i == config.repeats-1);
      }
    } else {
      for(var i = 0; i < config.repeats; i++) {
        var rest = config.mode === MODES['REST']
                   || (config.mode === MODES['SINGLE'] && i > 0);

        scheduleNote(current16thNote, nextNoteTime, config.note, rest);
        nextNote(i == config.repeats-1);
      }
    }

    var oscs = oscillators.length
    if(oscs >= 100){
      oscillators = oscillators.slice(oscs-20, oscs);
      console.log('purged oscillators', oscillators.length);
    }
  }

  timerID = window.setTimeout(scheduler, lookahead);
}

function play() {
  isPlaying = !isPlaying;

  if (isPlaying) { // start playing
    current16thNote = 0;
    nextNoteTime = audioContext.currentTime;
    scheduler();    // kick off scheduling
    return "playing";
  } else {
    window.clearTimeout( timerID );
    return "stopped";
  }
}

function createCanvas() {
  var container = document.createElement('div');
  container.className = "container";
  canvas = document.createElement('canvas');
  canvasContext = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(container);
  container.appendChild(canvas);
  canvasContext.strokeStyle = "#ffffff";
  canvasContext.lineWidth = 2;
}

function resetCanvas (e) {
  // resize the canvas - but remember - this clears the canvas too.
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  //make sure we scroll to the top left.
  window.scrollTo(0,0);
}

function draw() {
  var currentNote = last16thNoteDrawn;
  var currentTime = audioContext.currentTime;

  while (notesInQueue.length && notesInQueue[0].time < currentTime) {
    currentNote = notesInQueue[0].note;
    notesInQueue.splice(0,1);   // remove note from queue
  }

  // We only need to draw if the note has moved.
  if (last16thNoteDrawn != currentNote) {
    var x = Math.floor( canvas.width / 18 );
    canvasContext.clearRect(0,0,canvas.width, canvas.height);
    for (var i=0; i<16; i++) {
      canvasContext.fillStyle = ( currentNote == i ) ?
        ((currentNote%4 === 0)?"red":"blue") : "black";
      canvasContext.fillRect( x * (i+1), x, x/2, x/2 );
    }
    last16thNoteDrawn = currentNote;
  }

  // set up to draw again
  requestAnimFrame(draw);
}

function init(){
  createCanvas();

  tempo = document.querySelector('#tempo').value;
  // NOTE: THIS RELIES ON THE MONKEYPATCH LIBRARY BEING LOADED FROM
  // Http://cwilso.github.io/AudioContext-MonkeyPatch/AudioContextMonkeyPatch.js
  // TO WORK ON CURRENT CHROME!!  But this means our code can be properly
  // spec-compliant, and work on Chrome, Safari and Firefox.

  audioContext = new AudioContext();
  masterGain = audioContext.createGain();
  masterFilter = new Filter(audioContext,
                            document.querySelector('#cutoff').value,
                            document.querySelector('#q').value);
  masterDelay = new Delay(audioContext);

  masterGain.gain.value = 0.5;

  masterGain.connect(masterFilter.getNode());

  masterFilter.getNode().connect(masterDelay.getNode());
  masterDelay.connect(audioContext.destination);
  masterFilter.connect(audioContext.destination);

  window.onorientationchange = resetCanvas;
  window.onresize = resetCanvas;

  setupControls();
  // Setup initial step config
  reset();

  // Start
  requestAnimFrame(draw);
}

function setupControls() {
  freqs = {};
  for(var i = 0; i < notes.length; i++) {
    freqs[notes[i].latin()] = notes[i].frequency();
  }

  var pitchSliders = document.querySelectorAll('#pitches webaudio-slider');
  for(var i = 0; i < pitchSliders.length; ++i) {
    pitchSliders[i].addEventListener('change', changePitch);
  }

  var modeSliders = document.querySelectorAll('#modes webaudio-slider');
  for(var i = 0; i < modeSliders.length; ++i) {
    modeSliders[i].addEventListener('change', changeMode);
  }

  var repeatSliders = document.querySelectorAll('#repeats webaudio-slider');
  for(var i = 0; i < repeatSliders.length; ++i) {
    repeatSliders[i].addEventListener('change', changeRepeat);
  }

  document.querySelector('#cutoff').addEventListener('change', changeCutoff);
  document.querySelector('#q').addEventListener('change', changeQ);
  document.querySelector('#play').addEventListener('change', play);
  document.querySelector('#tempo').addEventListener('change', changeTempo);
  document.querySelector('#resolution').addEventListener('change', changeStepResolution);
}

function changeTempo(e) {
  tempo = e.target.value;
}

function changeStepResolution(e) {
  noteResolution = e.target.value;
}

function changeCutoff(e) {
  masterFilter.setCutoff(e.target.value);
}

function changeQ(e) {
  masterFilter.setQ(e.target.value);
}

function changePitch(e) {
  var stepIdx = idFromString(e.target.id);
  stepInstructions[stepIdx].note = notes[e.target.value].frequency();
}

function changeMode(e) {
  var stepIdx = idFromString(e.target.id);
  stepInstructions[stepIdx].mode = e.target.value;
}

function changeRepeat(e) {
  var stepIdx = idFromString(e.target.id);
  stepInstructions[stepIdx].repeats = e.target.value;
}

function idFromString(str) {
  var split = str.split('_');
  return split[1];
}


// LIBRARIES
var Oscillator = function(audioContext, frequency) {
  this.ctx = audioContext;
  this.node = this.ctx.createOscillator();
  this.setFrequency(frequency);
  this.node.type = 'square';
};

Oscillator.prototype.setFrequency = function(frequency) {
  this.node.frequency.value = frequency || 440;
};

Oscillator.prototype.connect = function(nextNode) {
  return this.getNode().connect(nextNode);
};

Oscillator.prototype.start = function(when) {
  this.node.start(when);
};

Oscillator.prototype.stop = function(when) {
  this.node.stop(when);
};

Oscillator.prototype.getNode = function() {
  return this.node;
};


var Delay = function(audioContext) {
  this.wet = 0.2;
  this.node = audioContext.createDelay();
  this.setDelayTime(tempo/3);
  this.gainNode = audioContext.createGain();
  this.gainNode.gain.value = this.wet;
}

Delay.prototype.setDelayTime = function(ms) {
  this.delayTime = ms;
  this.node.delayTime.value = this.delayTime * 0.01;
};

Delay.prototype.connect = function(nextNode) {
  this.node.connect(this.gainNode);
  this.gainNode.connect(nextNode);
};

Delay.prototype.getNode = function() {
  return this.node;
};


var Filter = function(audioContext, cutoff, q) {
  this.ctx = audioContext;
  this.lowpass = this.ctx.createBiquadFilter();
  this.lowpass.type = 'lowpass';
  this.setQ(q || 10);
  this.setCutoff(cutoff || 50);
  this.gainNode = audioContext.createGain();
  this.gainNode.gain = 0.5;
};

Filter.prototype.now = function() {
  return this.ctx.currentTime;
}

//from http://www.html5rocks.com/en/tutorials/webaudio/intro/js/filter-sample.js
Filter.prototype.setCutoff = function(value) {
  value *= 0.01;
  // Clamp the frequency between the minimum value (40 Hz) and half of the
  // sampling rate.
  var minValue = 100;
  var maxValue = this.ctx.sampleRate / 2;
  // Logarithm (base 2) to compute how many octaves fall in the range.
  var numberOfOctaves = Math.log(maxValue / minValue) / Math.LN2;
  // Compute a multiplier from 0 to 1 based on an exponential scale.
  var multiplier = Math.pow(2, numberOfOctaves * (value - 1.0));

  console.log("Oct", numberOfOctaves, "Mult", multiplier, "Final", maxValue * multiplier);

  // Get back to the frequency value between min and max.
  this.lowpass.frequency.linearRampToValueAtTime(maxValue * multiplier, this.now());
}

Filter.prototype.setQ = function(q) {
  var scale = 30;
  this.lowpass.Q.linearRampToValueAtTime(q/100 * scale, this.now());
};

Filter.prototype.connect = function(nextNode) {
  this.lowpass.connect(this.gainNode);
  this.gainNode.connect(nextNode);
};

Filter.prototype.getNode = function() {
  return this.lowpass;
};



window.addEventListener("load", init );
