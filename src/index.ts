import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import * as L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';

import {FeatureCollection, Polygon} from  'geojson';

import CodeMirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
// import 'codemirror/addon/display/fullscreen.css';
import 'codemirror/theme/dracula.css';
import 'codemirror/mode/javascript/javascript.js';
// import 'codemirror/addon/display/fullscreen.js';

const textArea: HTMLTextAreaElement = document.getElementById('editor') as HTMLTextAreaElement;

const config: CodeMirror.EditorConfiguration = {
    tabSize: 4,
    lineNumbers: true,
    mode: 'javascript',
    theme: 'dracula',
    lineWrapping: true,
};

const editor = CodeMirror(textArea, config);
// editor.getWrapperElement().style.height="100%";

// Following requires are needed so that webpack file-loader copies those files to `dist`.
const iconRetinaUrl = require('leaflet/dist/images/marker-icon-2x.png');
const iconUrl = require('leaflet/dist/images/marker-icon.png');
const shadowUrl = require('leaflet/dist/images/marker-shadow.png');

const map = L.map('map');

const defaultCenter : L.LatLngTuple = [52.520008, 13.404954];
const defaultZoom = 15;
map.setView(defaultCenter, defaultZoom);

const basemap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
});
basemap.addTo(map);

let inputLayer : L.LayerGroup;
let resultLayer : L.FeatureGroup | undefined;

const changeHandler = (instance: CodeMirror.Editor, change : CodeMirror.EditorChange) => {
  console.log('change');
  
  //FIXME: Error handling and validation
  const geojson = JSON.parse(editor.getValue()) as FeatureCollection;

  // Clear map first
  map.eachLayer((layer)=> {
    if(layer!==basemap) {
      map.removeLayer(layer);
    }
  });

  L.geoJSON(geojson).addTo(map);
}

const computeButton = document.getElementById("compute") as HTMLButtonElement;
const operationSelect = document.getElementById("operation") as HTMLSelectElement;
const resultTextArea = document.getElementById("result") as HTMLTextAreaElement;


const computeHandler = () => {
  // Clear map first, especially previous results
  map.eachLayer((layer)=> {
    if(layer!==basemap) {
      map.removeLayer(layer);
    }
  });

  //TODO: Error handling and validation
  const geojson = JSON.parse(editor.getValue()) as FeatureCollection;

  // Add the editor input again.
  inputLayer = L.geoJSON(geojson).addTo(map);

  const operation = operationSelect.selectedOptions[0].text;

  console.log(`Computing ${operation}`);
  fetch(
    operation,
    {
      method: 'POST',
      body: JSON.stringify(geojson),
      headers: {
        'Content-Type': 'application/json'
      },
    }
  ).then(value => value.json()).then(json => {
    const geoJson = json as FeatureCollection;
    // Mark the features that are coming from the REST API to be able to filter them out later.
    for(const feature of geoJson.features) {
      if (!feature.properties) {
        feature.properties = {
          isResult: true
        }
      } else {
        feature.properties["isResult"] = true;
      }
    }
    resultLayer = L.geoJSON(json);
    resultLayer.pm.setOptions({
      allowEditing: false,
      draggable: false
    })
    resultLayer.setStyle({ color: 'red' }).addTo(map);
    resultLayer.bringToBack();
    resultTextArea.value = JSON.stringify(json, undefined, 4);
    for(const feature of geoJson.features) {
      if (feature.geometry.type == 'Polygon' && feature.properties?.sequence) {
        const point = feature.geometry.coordinates[0][0];
        const marker = L.marker([point[1], point[0]], {
          textMarker: true,
          text: feature.properties.sequence,
        }).addTo(resultLayer);
        marker.pm.setOptions({
          allowEditing: false,
          draggable: false    
        });
      }
    }
  }).catch(reason => {
    if (resultLayer) {
      map.removeLayer(resultLayer);
      resultLayer = undefined;
    }
  })
}

function updateTextEditor() {
  if (resultLayer) {
    map.removeLayer(resultLayer);
  }
  
  const geoJson = map.pm.getGeomanLayers(true).toGeoJSON() as FeatureCollection;

  geoJson.features = geoJson.features.filter((feature)=> {
    return !(feature.properties?.isResult === true);
  });

  if (resultLayer) {
    map.addLayer(resultLayer);
  }

  editor.off('change', changeHandler);
  editor.setValue(JSON.stringify(geoJson, undefined, 4));
  editor.on('change', changeHandler);
}

computeButton.addEventListener('click', computeHandler);

editor.on('change', changeHandler);

// add Leaflet-Geoman controls with some options to the map  
map.pm.addControls({
  position: 'topleft',
  drawCircle: false,
});

// Register events to keep editor and map in sync.
map.on('pm:globaleditmodetoggled', (e) => {
  console.log('pm:globaleditmodetoggled');
  e.map.eachLayer((layer) => {
    if (e.enabled) {
      // layer.on('pm:dragend', (e)=>{
      //   console.log('pm:dragend');
      // })
    } else {
      // There are so many events to listen to,
      // so for now we just update the editor when edit mode is toggled off again.
      // layer.off('pm:dragend');
      updateTextEditor();
    }
  })
});

map.on('pm:globaldragmodetoggled', (e) => {
  console.log('pm:globaldragmodetoggled');
  e.map.eachLayer((layer) => {
    if (e.enabled) {
      layer.on('pm:dragend', (e)=>{
        console.log('pm:dragend');
        updateTextEditor();
      })
    } else {
      layer.off('pm:dragend');
    }
  })
});

map.on('pm:globalremovalmodetoggled', (e) => {
  console.log('pm:globaldragmodetoggled');
  e.map.eachLayer((layer) => {
    if (e.enabled) {
      layer.on('pm:remove', (e)=>{
        console.log('pm:remove');
        updateTextEditor();
      })
    } else { 
      layer.off('pm:remove');
    }
  })
});

map.on('pm:drawend', (e) => {
  console.log('pm:drawend');
  updateTextEditor();
});

