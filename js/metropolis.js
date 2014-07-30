
var canvas,                 // the canvas element
canvasContext;          // canvasContext is the canvas' context 2D
                            // and may or may not have played yet. {note, time}


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

var Sequencer = function(tempo) {
  this.audioContext = new AudioContext();
  this.tempo = tempo;
  this.stepInstructions = {};
  // This is calculated from lookahead, and overlaps
  // with next interval (in case the timer is late)
  this.nextNoteTime = 0.0;     // when the next note is due.
  this.noteResolution = 0;     // 0 == 16th, 1 == 8th, 2 == quarter note
  this.gateLength = 0.3; // relative note length
  this.timerID = 0;            // setInterval identifier.
  this.current16thNote;        // What note is currently last scheduled?
  this.lookahead = 25.0;       // How frequently to call scheduling function (ms)
  this.scheduleAheadTime = 0.1;    // How far ahead to schedule audio (sec)
  this.last16thNoteDrawn = -1; // the last "box" we drew on the screen
  this.notesInQueue = [];      // the notes that have been put into the web audio,
  this.MODES = {
    'REST': 0,
    'SINGLE': 1,
    'REPEAT': 2,
    'HOLD': 3
  };
  this.isPlaying = false;      // Are we currently playing?
  this.oscillators = [];

  this.notes = Note.fromLatin('G3').scale('natural minor');
  this.DEFAULT_STEPS = [
    // mode = numeric mode
    // repeats = num times to play or length to hold
    // note = frequency
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[0].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[1].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[2].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[3].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[4].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[5].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[6].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[7].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[0].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[1].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[2].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[3].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[4].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[5].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[6].frequency() },
    { mode: this.MODES['SINGLE'], repeats: 1, note: this.notes[7].frequency() }
  ]

  this.pitchSliders = document.querySelectorAll('#pitches webaudio-slider');
  this.modeSliders = document.querySelectorAll('#modes webaudio-slider');
  this.repeatSliders = document.querySelectorAll('#repeats webaudio-slider');
}

Sequencer.prototype.nextNote = function(advance) {
  // Advance current note and time by a 16th note...
  var secondsPerBeat = 60.0 / this.tempo;    // Notice this picks up the CURRENT
  // tempo value to calculate beat length.
  this.nextNoteTime += 0.25 * secondsPerBeat;    // Add beat length to last beat time

  if(advance != false) {
    this.current16thNote++;    // Advance the beat number, wrap to zero
    if (this.current16thNote == 16) {
      this.current16thNote = 0;
    }
  }
}

Sequencer.prototype.scheduleNote = function(beatNumber, time, noteHertz, rest, lengthMultiplier){
  // push the note on the queue, even if we're not playing.
  this.notesInQueue.push( { note: beatNumber, time: time } );
  if(typeof(lengthMultiplier) === 'undefined') lengthMultiplier = 1;

  if ( (this.noteResolution==1) && (beatNumber%2))
    return; // we're not playing non-8th 16th notes
  if ( (this.noteResolution==2) && (beatNumber%4))
    return; // we're not playing non-quarter 8th notes

  if(!rest) {
    // create an oscillator
    var osc = new Oscillator(this.audioContext, noteHertz),
        gain = this.audioContext.createGain(),
        attackTime = 0.02,
        releaseTime = 0.01,
        trueNoteLength = this.noteLength() * lengthMultiplier,
        noteEnd = time + attackTime + trueNoteLength + releaseTime;

    osc.connect(gain);
    gain.connect(this.masterGain);


    gain.gain.value = 0;

    gain.gain.cancelScheduledValues(time);
    gain.gain.linearRampToValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.8, time + attackTime);
    gain.gain.linearRampToValueAtTime(0, noteEnd);

    osc.start(time);
    osc.stop(noteEnd);
    this.oscillators.push(osc);
  }
}

Sequencer.prototype.noteLength = function() {
  return (60.0 / this.tempo) * this.gateLength;
}

// Randomly change all step values
Sequencer.prototype.randomize = function() {
  for(var step in this.stepInstructions) {
    var pitchNum = this.randomNumberInRange(this.notes.length),
        note = this.notes[pitchNum].frequency();

    var data = {
      note: note,
      mode: this.randomNumberInRange(4),
      repeats: this.randomNumberInRange(8, 1)
    };

    this.updateValues(step, data, true);
  }

}

Sequencer.prototype.reset = function() {
  for( var step in this.DEFAULT_STEPS ) {
    var data = {
      note: this.DEFAULT_STEPS[step].note,
      mode: this.DEFAULT_STEPS[step].mode,
      repeats: this.DEFAULT_STEPS[step].repeats
    };

    this.updateValues(step, data, true);
  }
}

Sequencer.prototype.updateValues = function(step, data, updateDisplay) {
    this.stepInstructions[step] = {};
    this.stepInstructions[step].mode = data.mode;
    this.stepInstructions[step].repeats = data.repeats;
    this.stepInstructions[step].note = data.note;


    if(updateDisplay === true) {

      var pitchNum = _.findIndex(this.notes, function(note){
        return Math.round(note.frequency()) == Math.round(data.note);
      });

      this.pitchSliders[step].setValue(pitchNum);
      this.repeatSliders[step].setValue(data.repeats);
      this.modeSliders[step].setValue(data.mode);
    }
}

Sequencer.prototype.randomNumberInRange = function(range, min) {
  var num = Math.floor(Math.random() * range);
  var min = min || 0;

  return min < num ? num : min;
}

Sequencer.prototype.scheduler = function() {
  // while there are notes that will need to play before the next interval,
  // schedule them and advance the pointer.
  while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTime ) {
    var config = this.stepInstructions[this.current16thNote];

    // cleanup this brainfart
    // could make nextNote do the scheduleNote work inside. pass all the args
    if(config.mode == this.MODES['HOLD']) {
      this.scheduleNote(this.current16thNote, this.nextNoteTime, config.note, config.mode == this.MODES['REST'], config.repeats);
      for(var i = 0; i < config.repeats; i++) {
        this.nextNote(i == config.repeats-1);
      }
    } else {
      for(var i = 0; i < config.repeats; i++) {
        var rest = config.mode === this.MODES['REST']
                   || (config.mode === this.MODES['SINGLE'] && i > 0);

        this.scheduleNote(this.current16thNote, this.nextNoteTime, config.note, rest);
        this.nextNote(i == config.repeats-1);
      }
    }

    var oscs = this.oscillators.length
    if(oscs >= 100){
      this.oscillators = this.oscillators.slice(oscs-20, oscs);
      console.log('purged oscillators', this.oscillators.length);
    }
  }

  this.timerID = window.setTimeout(function(){
    this.scheduler();
  }.bind(this), this.lookahead);
}

Sequencer.prototype.play = function() {
  this.isPlaying = !this.isPlaying;

  if (this.isPlaying) { // start playing
    this.current16thNote = 0;
    this.nextNoteTime = this.audioContext.currentTime;
    this.scheduler();
  } else {
    window.clearTimeout(this.timerID);
  }
}

//function createCanvas() {
  //var container = document.createElement('div');
  //container.className = "container";
  //canvas = document.createElement('canvas');
  //canvasContext = canvas.getContext('2d');
  //canvas.width = window.innerWidth;
  //canvas.height = window.innerHeight;
  //document.body.appendChild(container);
  //container.appendChild(canvas);
  //canvasContext.strokeStyle = "#ffffff";
  //canvasContext.lineWidth = 2;
//}

//function resetCanvas(e) {
  //// resize the canvas - but remember - this clears the canvas too.
  //canvas.width = window.innerWidth;
  //canvas.height = window.innerHeight;

  ////make sure we scroll to the top left.
  //window.scrollTo(0,0);
//}

//function draw() {
  //var currentNote = last16thNoteDrawn;
  //var currentTime = audioContext.currentTime;

  //while (notesInQueue.length && notesInQueue[0].time < currentTime) {
    //currentNote = notesInQueue[0].note;
    //notesInQueue.splice(0,1);   // remove note from queue
  //}

  //// We only need to draw if the note has moved.
  //if (last16thNoteDrawn != currentNote) {
    //var x = Math.floor( canvas.width / 18 );
    //canvasContext.clearRect(0,0,canvas.width, canvas.height);
    //for (var i=0; i<16; i++) {
      //canvasContext.fillStyle = ( currentNote == i ) ?
        //((currentNote%4 === 0)?"red":"blue") : "black";
      //canvasContext.fillRect( x * (i+1), x, x/2, x/2 );
    //}
    //last16thNoteDrawn = currentNote;
  //}

  //// set up to draw again
  //requestAnimFrame(draw);
//}

Sequencer.prototype.init = function(){
  //createCanvas();

  this.masterFilter = new Filter(this.audioContext,
                                document.querySelector('#cutoff').value,
                                document.querySelector('#q').value);
  this.masterDelay = new Delay(this.audioContext, this.tempo);

  this.masterGain = this.audioContext.createGain();
  this.masterGain.gain.value = 0.2;

  this.masterGain.connect(this.masterFilter.getNode());
  this.masterFilter.getNode().connect(this.masterDelay.getNode());
  this.masterDelay.connect(this.audioContext.destination);
  this.masterFilter.connect(this.audioContext.destination);

  //window.onorientationchange = resetCanvas;
  //window.onresize = resetCanvas;

  this.setupControls();

  // Setup initial step config
  this.reset();

  // Start
  requestAnimFrame(function(){ this.draw }.bind(this), false);
}

Sequencer.prototype.setupControls = function() {
  for(var i = 0; i < this.pitchSliders.length; ++i) {
    this.pitchSliders[i].addEventListener('change', function(e){
      this.changePitch(e);
    }.bind(this));
  }

  for(var i = 0; i < this.modeSliders.length; ++i) {
    this.modeSliders[i].addEventListener('change', function(e){
      this.changeMode(e);
    }.bind(this));
  }

  for(var i = 0; i < this.repeatSliders.length; ++i) {
    this.repeatSliders[i].addEventListener('change', function(e){
      this.changeRepeat(e);
    }.bind(this));
  }

  document.querySelector('#cutoff').addEventListener('change', function(e){
    this.masterFilter.setCutoff(e.target.value);
  }.bind(this));

  document.querySelector('#q').addEventListener('change', function(e){
    this.masterFilter.setQ(e.target.value);
  }.bind(this));

  document.querySelector('#play').addEventListener('change', function(e){
    this.play();
  }.bind(this));

  document.querySelector('#tempo').addEventListener('change', function(e){
    this.changeTempo(e);
  }.bind(this));

  document.querySelector('#resolution').addEventListener('change', function(e){
    this.changeStepResolution(e);
  }.bind(this));

  document.querySelector('#random').addEventListener('click', function(e){
    this.randomize();
  }.bind(this));

  document.querySelector('#reset').addEventListener('click', function(e){
    this.reset();
  }.bind(this));
}

Sequencer.prototype.changeTempo = function(e) {
  this.tempo = e.target.value;
}

Sequencer.prototype.changeStepResolution = function (e) {
  this.noteResolution = e.target.value;
}

Sequencer.prototype.changePitch = function(e) {
  var stepIdx = this.idFromString(e.target.id);
  this.stepInstructions[stepIdx].note = this.notes[e.target.value].frequency();
}

Sequencer.prototype.changeMode = function(e) {
  var stepIdx = this.idFromString(e.target.id);
  this.stepInstructions[stepIdx].mode = e.target.value;
}

Sequencer.prototype.changeRepeat = function(e) {
  var stepIdx = this.idFromString(e.target.id);
  this.stepInstructions[stepIdx].repeats = e.target.value;
}

Sequencer.prototype.idFromString = function(str) {
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
  var portamento = 0;
  this.node.frequency.exponentialRampToValueAtTime(frequency, this.ctx.currentTime + portamento)
  //this.node.frequency.value = frequency || 440;
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


var Delay = function(audioContext, tempo) {
  this.wet = 0.2;
  this.tempo = tempo;
  this.node = audioContext.createDelay();
  this.setDelayTime(this.tempo/3);
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

  //console.log("Oct", numberOfOctaves, "Mult", multiplier, "Final", maxValue * multiplier);

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


Sequencer.prototype.run = function() {
  window.addEventListener('load', function(e) {
    var tempo = document.querySelector('#tempo').value;
    window.metropolis = new Sequencer(tempo);
    window.metropolis.init();
  }.bind(this), false);
}();
