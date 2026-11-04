output "ec2_public_ip" {
  description = "Public IP of the BusBooking EC2 host"
  value       = aws_instance.app.public_ip
}

output "ec2_instance_id" {
  value = aws_instance.app.id
}

output "ecr_repository_urls" {
  description = "ECR repository URLs keyed by service"
  value       = { for name, repo in aws_ecr_repository.services : name => repo.repository_url }
}

output "security_group_id" {
  value = aws_security_group.app.id
}
