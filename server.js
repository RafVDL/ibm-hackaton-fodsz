const express = require("express");
const app = express();
const bodyParser = require('body-parser');
const xml = require('xml-js');
const fs = require('fs');
const path = require('path');
const find = require('find');
const mongoose = require('mongoose');
require('dotenv').config();

// models
const Patient = require('./model/Patient.model');
const Click = require('./model/Click.model');

let patientIds = [];
fs.readdirSync('./db').forEach(file => {
  if (file.isDirectory())
    console.log(file);
})

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true });

function getPatient(id, request, response) {
  if (!fs.existsSync(path.resolve('db/patient' + id))) {
    response.status(404).json({
      "error": "Patient not found"
    });
    console.log("Patient not found: " + request.params.id);
    return;
  }
  find.file(/\.xml$/, __dirname + "/db/patient" + id, function (files) {
    if (files.length == 0) {
      response.status(404).json({
        "error": "Patient information not found"
      });
      console.log("Patient information not found: " + request.params.id);
      return;
    }
    let xmlData = fs.readFileSync(files[0], 'utf8');
    let result = xml.xml2js(xmlData, { compact: true });
    let databaseResult = undefined;

    Patient.findOne({ patient_id: id }).populate('clicks').exec(function (err, dbResult) {
      if (err) {
        console.log("");
      } else if (!dbResult) {
        // patient not known in database
        let patient = new Patient({ patient_id: id });
        patient.save(function (err, dbResult) {
          if (err) {
            console.log("Failed to initialize person");
            console.log(err);
          }
        });
      } else {
        databaseResult = dbResult;
      }

      let occurrenceICD = xmlData.indexOf("S=\"ICD\"");
      let tagStart = occurrenceICD, tagEnd = occurrenceICD;
      do {
        --tagStart;
      } while (tagStart > 0 && xmlData.substring(tagStart, tagStart + 3) != '<cd')
      do {
        ++tagEnd;
      } while (tagEnd < xmlData.length && xmlData.substring(tagEnd - 5, tagEnd) != '</cd>')
  
      // do {
      //   --tagStart;
      // } while (tagStart > 0 && xmlData.substring(tagStart, tagStart + 6) != '<item>')
      // do {
      //   ++tagEnd;
      // } while (tagEnd < xmlData.length && xmlData.substring(tagEnd - 7, tagEnd) != '</item>')
  
      let tag = xml.xml2js(xmlData.substring(tagStart, tagEnd));
      let illness = tag.elements[0].attributes.DN;
  
      if (!illness)
        illness = tag.elements[0].elements[0].text;
  
      return response.json({
        "id": request.params.id,
        "patient_info": {
          "id": request.params.id,
          "first_name": result.kmehrmessage.folder.patient.firstname._text,
          "last_name": result.kmehrmessage.folder.patient.familyname._text,
          "birthdate": result.kmehrmessage.folder.patient.birthdate.date._text,
          "sex": result.kmehrmessage.folder.patient.sex.cd._text
        },
        "demand": "parking license",
        "pathologies": [
          illness
        ],
        "db": databaseResult,
        "keywords": {
          "prothese": [
            {
              "data_type": "text",
              "value": "2007: Totale heupprothese links"
            }
          ],
          "hypoxie": [{
            "data_type": "text",
            "value": "COPD GOLD III met emfyseem en bronchiëctasieën; reeds nachtelijke hypoxie in 2012 maar blijvende nicotine-abusus."
          }],
          "atelectase": [{
            "data_type": "text",
            "value": "Eind 2015 consultatie toegenomen hoesten en ook vermagering; CT thorax wat atelectase rechter MK."
          }],
          "exacerbatie": [{
            "data_type": "text",
            "value": "11-2016 COPD exacerbatie, sputumkweek: Moraxella en Haemofilus Influenzae\nR/ Augmentin"
          }],
          "pleuritis": [{
            "data_type": "text",
            "value": "Licht afgestompte longsinussen : sequelen pleuritis of lichtgradige hoeveelheid pleuravocht."
          }]
        }
      });
    });
  });
}

let startRandomId = 9;

// get random patient
app.get('/api/patient', (request, response) => {
  let id = ("0" + startRandomId++).slice(-2);
  getPatient(id, request, response);
});

app.get("/api/patient/:id", (request, response) => {
  let id = ("0" + request.params.id).slice(-2);
  getPatient(id, request, response);
});

app.put('/api/patient/:id', (request, response) => {
  let id = ("0" + request.params.id).slice(-2);
  console.log("Saving scores for patient " + request.params.id + " ( " + request.body.score.length + " categories)");
  Patient.findOneAndUpdate({ patient_id: id }, { score: request.body.score }, (err, result) => {
    if (err)
      return response.status(500).json({
        "error": "failed to save patient"
      })
    if (!result)
      return response.status(404).json({
        "error": "patient not found"
      })
    console.log(result);
    return response.json({
      "message": "success"
    })
  });
});

app.post('/api/patient/:id/click', (request, response) => {
  let id = ("0" + request.params.id).slice(-2);
  if (!fs.existsSync(path.resolve('db/patient' + id))) {
    response.status(404).json({
      "error": "Patient not found"
    });
    console.log("Patient not found: " + request.params.id);
    return;
  }

  console.log("Captured click for patient " + id + ": " + request.body.keyword);

  Patient.findOne({ patient_id: id }).populate('clicks').exec(function (err, result) {
    if (err)
      return response.status(500).json({
        "error": "failed to add click"
      })
    if (!result)
      return response.status(405).json({
        "error": "non existent"
      })
    let click = new Click({ keyword: request.body.keyword});
    click.save(function (err, result2) {
      if (err)
        return response.status(500).json({
          "error": "failed to add click"
        })
      result.clicks.push(result2);
      result.save(function (err, result) {
        if (err)
          return response.status(500).json({
            "error": "failed to add click"
          })
        return response.json({
          "message": "success"
        })
      });
    });
  });
});

var port = process.env.PORT || 3000
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {
  Click.deleteMany({}, (err, result) => {
    console.log("Deleted clicks");
  });
  Patient.deleteMany({}, (err, result) => {
    console.log("Deleted patients");
  });
  app.listen(port, function () {
    console.log("To view your app, open this link in your browser: http://localhost:" + port);
  });
});
