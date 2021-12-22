var cluster = require('cluster'); // 클러스터 모듈 로드
var numCPUs = require('os').cpus().length; // CPU 개수 가져오기



if (cluster.isMaster) { // 마스터 처리
console.log('number of cpu = ' + numCPUs + '\n');

for (var i = 0; i < (numCPUs/2); i++) {
cluster.fork(); // CPU 개수만큼 fork
}
// 워커 종료시 다잉 메시지 출력
cluster.on('exit', function(worker, code, signal) {
console.log('worker ' + worker.process.pid + ' died');
});
}

else { // 워커 처리

	const express = require('express');
	const app = express();
	const moment = require('moment');

	const port = 3005;
	app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));

	const redis = require('redis');
	client = redis.createClient(6379, '127.0.0.1');

	const stopInterval = 1800000; // 30 min
	const timeWindow = 300000; // 5 min

	// ================================================================
	var st, pt, data_count=0;
	app.post('/profile', function(req, res){

		if(st == null){
			  st = moment(new Date());
			  data_count++;
		}
		else
		{
			  pt = moment(new Date());
			  et = pt - st; 
			  data_count++;
			  //console.log(st, pt, "elapseTime:", et, " count:", data_count);
		}

		if(data_count>2550){
			  console.log(st, pt, "elapseTime:", et, " count:", data_count);
		}


		var fullBody = '';

		req.on('data', function(chunk) {
			fullBody += chunk; 
		});

		req.on('end', async function(){
			var jsonbody = JSON.parse(fullBody);
			let cinContents = jsonbody['m2m:sgn'].nev.rep['m2m:cin'].con;

			var {ae, lat, lng, wtime} = cinContents;
			var values = JSON.stringify(cinContents);

			client.zadd('sorted_' + ae, wtime, values, function(err, data){
				if(err){
					console.log(err);
				}
				//console.log("zadd:", data);
			});
		  
	////SCEN2.30분간 움직이지 않은 디바이스 찾기
			var MovingPointdata = await getDataFromRedis('MovingPoint_' + ae);
			
			if(MovingPointdata === null){
				setDataToRedis('MovingPoint_' + ae, values);
				//res.status(200).send('MovingPointdata save success');
			}
			else { 
				
				//var Threshold = await getAverageForThreshold(ae, MovingPointdata, cinContents); 		
				var dt = distance(MovingPointdata.lat, MovingPointdata.lng, lat, lng);
				if(dt < 5){
				//NotMoving
					if(wtime - MovingPointdata.wtime > stopInterval){
					//움직이지 않은채로 30분 이상 흐름
						writeToInflux();
						console.log(`SCEN2. Not move, and 30 min passed, input MovingPointdata to InfluxDB. device: ${ae} time: ${wtime}`);
						//res.status(200).send('30 min passed, input MovingPointdata to InfluxDB');
					}
					else {
					//움직이지 않았으나 30분이 지나지 않음.
						console.log(`SCEN2. Not move, but 30 minutes not passed. device: ${ae} time: ${wtime}`);
					}
				}
				else {
				//Moving
					setDataToRedis('MovingPoint_' + ae, values);
					console.log(`SCEN2. Move, set MovingPoint to Redis. device: ${ae} time: ${wtime}`);
				}
			}
		
				  
	////SCEN1.튄데이터 찾기
			var predata = await getDataFromRedis('predata_' + ae);
			//console.log(predata);
			if(predata === null){
				setDataToRedis('predata_' + ae, values);
				//res.status(200).send('predata save success');
			}
			else { 
				var trueORfalse = await isValid(ae, timeWindow, predata, cinContents);			
				if(trueORfalse){
				//정상적인 데이터일 경우
					setDataToRedis('predata_' + ae, values);
					console.log(`SCEN1. Update NomalPoint. device: ${ae} time: ${wtime}`);
					//res.status(200).send("Update NomalPoint");
				}
				else {
				// 튄 데이터일 경우
					writeToInflux();
					console.log(`SCEN1.data is not valid device: ${ae} time: ${wtime}`);
					//res.status(200).send('input AbnormalPoint to InfluxDB');
				}
			}
			
			res.status(200).send('done');
			
					
	////SCEN2.30분간 움직인 디바이스 찾기 
			


		});
	});

	function getDataFromRedis(key) {
		return new Promise((resolve, reject) => {
			client.get(key, function (err, data) {
				if (err) {
					reject(err);
				}
				else {
					resolve(JSON.parse(data));
				}
			});
		});
	}

	function setDataToRedis(key, value) {
		client.set(key, value, function (err, data) {
			if (err) {
				console.log(`set err: ${err}`);
				return;
			}
		});
	}

	function distance(lat1, lng1, lat2, lng2) {
		var p = 0.017453292519943295;
		var c = Math.cos;
		var a = 0.5 - c((lat2 - lat1) * p) / 2 +
			 c(lat1 * p) * c(lat2 * p) *
			 (1 - c((lng2 - lng1) * p)) / 2;

		return (12742 * Math.asin(Math.sqrt(a)) * 1000);
	}

	function isValid(ae, timeWindow, PreviousData , CurrentData){
		var wtime = CurrentData.wtime;
	   
		return new Promise((resolve, reject) => {
			client.zremrangebyscore('sorted_' + ae, "-inf", wtime-timeWindow-1 );
			client.  ('sorted_' + ae, wtime-timeWindow, wtime, function(err, data){
				if(err){
					reject(err);
				}
				else {
					resolve(data);
				}
				
			});
			
		}).then(result => {
			
			var max = result.length;
			if(max === 0){
				return true;
			}
			var totalDistance = 0, avgDistance = 0;
		  
			for(var index=1; index<max; index++){
				var prePoint = JSON.parse(result[index-1]);
				var curPoint = JSON.parse(result[index]);
			 
				totalDistance += distance(prePoint.lat, prePoint.lng, curPoint.lat, curPoint.lng);
			}
			avgDistance = totalDistance / max;
			if(avgDistance ===0){
				return true;
			}
			console.log("========================");
			console.log("avg: " , avgDistance*4);
			console.log("distance:", distance(PreviousData.lat, PreviousData.lng, CurrentData.lat, CurrentData.lng));
					
			if(distance(PreviousData.lat, PreviousData.lng, CurrentData.lat, CurrentData.lng) > avgDistance*4){
				//console.log("The value is not valid");
				return false;
			}
			else {
				//console.log("The value is valid");
				return true;
			}
			
		});
	}

/* 	///////scen2의 threshold를 위한 함수지만 증가하는 dt와 일정한 threshold로 인해 알고리즘 오류!
	function getAverageForThreshold(ae, movingpointdata, current){
		var startTime = movingpointdata.wtime;
		var endTime = current.wtime;
		
		return new Promise((resolve, reject) => {
			client.zrangebyscore('sorted_' + ae, startTime, endTime, function(err, data){
				if(err){
					reject(err);
				}
				else {
					resolve(data);
				}
				
			});
			
		}).then(result => {
			
			var max = result.length;
			if(max === 0){
				return 5;
			}
			var totalDistance = 0, avgDistance = 0;
		  
			for(var index=1; index<max; index++){
				var prePoint = JSON.parse(result[index-1]);
				var curPoint = JSON.parse(result[index]);
			 
				totalDistance += distance(prePoint.lat, prePoint.lng, curPoint.lat, curPoint.lng);
			}
			avgDistance = totalDistance / max;
			if(avgDistance ===0){
				return 5;
			}
			else {
				console.log("func avg", avgDistance)
				return avgDistance*2;
			}
			
		});
	}
 */

	function writeToInflux(ae, values){
		
		console.log("input to InfluxDB success");
		
	}
	
}